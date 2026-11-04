"""本地假 SFTP 文件系统验证发布事务，不连接服务器或读取密钥。"""
import io
import json
from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch

import server_deploy as d
from pipeline import PipelineError, digest


class LocalSFTP:
    def __init__(self, root): self.root, self.events = root, []
    def path(self, path):
        result = self.root / path.lstrip('/')
        if '..' in result.parts: raise AssertionError(path)
        return result
    def mkdir(self, path): self.events.append(('mkdir', path)); self.path(path).mkdir()
    def lstat(self, path): return self.path(path).lstat()
    def open(self, path, mode): return self.path(path).open(mode)
    def put(self, local, remote, confirm):
        self.events.append(('put', remote)); self.path(remote).write_bytes(Path(local).read_bytes())
    def putfo(self, source, remote, **kwargs):
        self.events.append(('putfo', remote)); self.path(remote).write_bytes(source.read())
    def chmod(self, path, mode): self.path(path).chmod(mode)
    def rename(self, before, after):
        if self.path(after).exists(): raise FileExistsError(after)
        self.path(before).rename(self.path(after))
    def posix_rename(self, before, after):
        self.events.append(('commit', after)); os.replace(self.path(before), self.path(after))
    def remove(self, path):
        self.events.append(('remove', path)); self.path(path).unlink()
    def rmdir(self, path): self.path(path).rmdir()


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'pub/releases').mkdir(parents=True)
        self.sftp = LocalSFTP(self.root)
        self.local = self.root / 'package.exe'; self.local.write_bytes(b'fixture')
        self.files = {self.local.name: self.local}
        self.manifest = {'version': '0.39.2-custom.42', 'release_url': 'https://github.com/TheFBplus/note-gen/releases/tag/fixture',
                         'android': {'version_code': 1000000042}}
        self.old = dict(self.manifest, version='0.39.2-custom.41', android={'version_code': 1000000041})
        self.latest = self.root / 'pub/latest.json'
        self.latest.write_text(json.dumps(self.old))
        self.before = self.latest.read_bytes()
    def tearDown(self): self.temp.cleanup()
    def verify(self, url):
        path = self.root / 'pub' / url.removeprefix(d.BASE_URL)
        return digest(path)
    def deploy(self, verify=None):
        d.deploy_files(self.sftp, self.manifest, self.files, verify or self.verify)
    def test_packages_are_verified_before_atomic_manifest_commit(self):
        def verify(url):
            if '/releases/' in url: self.assertEqual(self.latest.read_bytes(), self.before)
            return self.verify(url)
        self.deploy(verify)
        self.assertEqual(json.loads(self.latest.read_bytes()), self.manifest)
        self.assertEqual([e for e in self.sftp.events if e[0] == 'commit'][-1], ('commit', '/pub/latest.json'))
        self.assertFalse((self.root / 'pub/.notegen-release-lock').exists())
        self.assertFalse(any(e == ('remove', '/pub/latest.json') for e in self.sftp.events))
    def test_upload_failure_preserves_old_channel(self):
        with patch.object(d, 'upload_file', side_effect=OSError('upload failed')):
            with self.assertRaises(OSError): self.deploy()
        self.assertEqual(self.latest.read_bytes(), self.before)
        self.assertTrue((self.root / 'pub/releases/.stage-0.39.2-custom.42').is_dir())
        self.assertFalse((self.root / 'pub/.notegen-release-lock').exists())
    def test_partial_prefix_is_verified_and_only_tail_is_written(self):
        remote = '/pub/releases/partial'
        self.sftp.path(remote).write_bytes(b'fix')
        real_open = self.sftp.open
        writes = []
        class Recorder:
            def __init__(self, stream): self.stream = stream
            def __enter__(self): self.stream.__enter__(); return self
            def __exit__(self, *args): return self.stream.__exit__(*args)
            def seek(self, offset): return self.stream.seek(offset)
            def write(self, data): writes.append(data); return self.stream.write(data)
        def tracked(path, mode):
            stream = real_open(path, mode)
            return Recorder(stream) if '+' in mode else stream
        with patch.object(self.sftp, 'open', side_effect=tracked):
            d.upload_file(self.sftp, self.local, remote)
        self.assertEqual(b''.join(writes), b'ture')
        self.assertEqual(self.sftp.path(remote).read_bytes(), b'fixture')

    def test_retry_reuses_partial_staging_and_still_verifies_before_commit(self):
        stage = '/pub/releases/.stage-0.39.2-custom.42'
        def interrupted(sftp, local, remote):
            sftp.path(remote).write_bytes(b'fix')
            raise OSError('connection lost')
        with patch.object(d, 'upload_file', side_effect=interrupted):
            with self.assertRaises(OSError): self.deploy()
        self.assertEqual(self.latest.read_bytes(), self.before)
        self.assertEqual(self.sftp.path(stage + '/package.exe').read_bytes(), b'fix')
        self.deploy()
        self.assertEqual(json.loads(self.latest.read_bytes()), self.manifest)
        self.assertFalse(self.sftp.path(stage).exists())

    def test_corrupt_or_oversized_staging_is_replaced(self):
        remote = '/pub/releases/partial'
        for content in [b'bad', b'corrupt', b'oversized content']:
            self.sftp.path(remote).write_bytes(content)
            d.upload_file(self.sftp, self.local, remote)
            self.assertEqual(self.sftp.path(remote).read_bytes(), b'fixture')

    def test_complete_staging_is_verified_without_rewriting(self):
        remote = '/pub/releases/partial'
        self.sftp.path(remote).write_bytes(b'fixture')
        with patch.object(self.sftp, 'open', wraps=self.sftp.open) as opened:
            d.upload_file(self.sftp, self.local, remote)
        self.assertEqual([call.args[1] for call in opened.call_args_list], ['rb'])

    def test_deadline_preserves_channel_and_releases_lock(self):
        with patch.object(d, '_deadline', 0):
            with self.assertRaises(PipelineError): self.deploy()
        self.assertEqual(self.latest.read_bytes(), self.before)
        self.assertFalse((self.root / 'pub/.notegen-release-lock').exists())

    def test_staging_symlink_is_rejected(self):
        stage = self.root / 'pub/releases/.stage-0.39.2-custom.42'
        stage.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(PipelineError): self.deploy()
        self.assertEqual(self.latest.read_bytes(), self.before)

    def test_https_failure_preserves_old_channel_and_retry_reuses_files(self):
        with self.assertRaises(PipelineError): self.deploy(lambda _: 'bad')
        self.assertEqual(self.latest.read_bytes(), self.before)
        self.sftp.events.clear(); self.deploy()
        self.assertFalse(any(e[0] == 'put' for e in self.sftp.events))
    def test_immutable_existing_version_cannot_be_overwritten(self):
        self.deploy(); self.latest.write_bytes(self.before)
        self.local.write_bytes(b'changed')
        with self.assertRaises(PipelineError): self.deploy()
        self.assertEqual(self.latest.read_bytes(), self.before)
        self.assertEqual((self.root / 'pub/releases/0.39.2-custom.42/package.exe').read_bytes(), b'fixture')
    def test_downgrade_and_same_version_replacement_are_rejected(self):
        for old in [dict(self.old, version='0.39.2-custom.43'), dict(self.manifest, release_url='other'), dict(self.old, android={'version_code':1000000043})]:
            self.latest.write_text(json.dumps(old)); before=self.latest.read_bytes()
            with self.assertRaises(PipelineError): self.deploy()
            self.assertEqual(self.latest.read_bytes(), before)
    def test_missing_posix_extension_never_deletes_old_channel(self):
        with patch.object(self.sftp, 'posix_rename', side_effect=OSError('unsupported')):
            with self.assertRaises(OSError): self.deploy()
        self.assertEqual(self.latest.read_bytes(), self.before)
        self.assertFalse(any(e == ('remove', '/pub/latest.json') for e in self.sftp.events))
    def test_existing_lock_prevents_concurrent_publish(self):
        self.sftp.mkdir('/pub/.notegen-release-lock')
        with self.assertRaises(FileExistsError): self.deploy()
        self.assertTrue((self.root / 'pub/.notegen-release-lock').exists())
    def test_rewritten_urls_and_landing_page(self):
        manifest = dict(self.manifest, platforms={'darwin-aarch64': {'url': 'https://github.com/a/b/download/update.tar.gz','signature':'sig'}}, android={'url':'https://github.com/a/b/download/app.apk','version_code':1000000042})
        converted=d.server_manifest(manifest)
        self.assertEqual(converted['platforms']['darwin-aarch64']['url'], d.BASE_URL+'releases/0.39.2-custom.42/update.tar.gz')
        self.assertEqual(manifest['android']['url'], 'https://github.com/a/b/download/app.apk')
        self.assertIn(b'package.exe', d.index_page(converted, self.files))
    def test_traversal_and_untrusted_redirect_are_rejected(self):
        self.files['../bad'] = self.local
        with self.assertRaises(PipelineError): self.deploy()
        with self.assertRaises(PipelineError): d.TrustedRedirects().redirect_request(None,None,302,'',{},'https://evil.example/file')


class RecoveryTests(unittest.TestCase):
    def test_unpublished_release_and_invalid_tag_are_rejected(self):
        import recover_release as recovery
        with patch.object(recovery, 'repository', return_value='TheFBplus/note-gen'), patch.object(recovery, 'api', return_value=None):
            for tag in ['../bad', 'custom-dev-u123456789abc-s123456789abc']:
                with self.assertRaises(PipelineError): recovery.recover(tag, '/unused', '/unused')

    def test_untrusted_asset_origin_and_hash_mismatch_are_rejected(self):
        import recover_release as recovery
        tag='custom-dev-u123456789abc-s123456789abc'
        for url, checksum in [('https://evil.example/file', 'sha256:'+'a'*64),
                              (f'https://github.com/TheFBplus/note-gen/releases/download/{tag}/file', 'sha256:'+'a'*64)]:
            with tempfile.TemporaryDirectory() as temporary:
                asset={'name':'file','size':1,'digest':checksum,'browser_download_url':url}
                with patch.object(recovery,'repository',return_value='TheFBplus/note-gen'), patch.object(recovery,'api',side_effect=[{'id':1,'draft':False},[asset]*8]), patch.object(recovery,'urlopen',return_value=io.BytesIO(b'x')):
                    with self.assertRaises(PipelineError): recovery.recover(tag,Path(temporary)/'packages',Path(temporary)/'metadata')

    def test_recovery_checks_complete_release_and_fixed_public_key(self):
        import recover_release as recovery
        import base64, hashlib
        tag='custom-dev-u123456789abc-s123456789abc'
        version='0.39.2-custom.42'
        data={f'NoteGen_{version}_'+suffix:b'package' for suffix in ['windows-x64-setup.exe','windows-x64-setup.exe.sig','macos-arm64.dmg','macos-arm64.app.tar.gz','macos-arm64.app.tar.gz.sig','android-arm64.apk']}
        for name in data:
            if name.endswith('.sig'): data[name]=base64.b64encode(b'fixture signature')
        data['build-info.json']=json.dumps({'tag':tag,'repository':'TheFBplus/note-gen','version':version}).encode()
        data['SHA256SUMS.txt']=''.join(hashlib.sha256(value).hexdigest()+'  '+name+'\n' for name,value in data.items()).encode()
        assets=[{'name':name,'size':len(value),'digest':'sha256:'+hashlib.sha256(value).hexdigest(),'browser_download_url':f'https://github.com/TheFBplus/note-gen/releases/download/{tag}/{name}'} for name,value in data.items()]
        with tempfile.TemporaryDirectory() as temporary, patch.object(recovery,'repository',return_value='TheFBplus/note-gen'), patch.object(recovery,'api',side_effect=[{'id':1,'draft':False},assets]), patch.object(recovery,'urlopen',side_effect=lambda url,timeout:io.BytesIO(data[url.rsplit('/',1)[-1]])), patch.object(recovery,'run') as verify:
            recovery.recover(tag,Path(temporary)/'packages',Path(temporary)/'info.json')
            self.assertEqual(verify.call_count,2)
            self.assertTrue(all(call.args[0]=='minisign' for call in verify.call_args_list))
            self.assertEqual(json.loads((Path(temporary)/'info.json').read_text())['tag'],tag)

    def test_only_one_approval_job_has_deployment_credentials(self):
        workflow=(Path(__file__).resolve().parents[2]/'.github/workflows/custom-dev-build.yml').read_text()
        before, signing=workflow.split('  sign-packages:',1)
        signing, recovery=signing.split('  republish-server:',1)
        self.assertNotIn('secrets.RELEASE_DEPLOY_SSH_KEY',before)
        self.assertIn('environment: custom-release', signing)
        self.assertIn('environment: custom-release', recovery)
        self.assertLess(signing.index('pipeline.py publish'),signing.index('server_deploy.py'))
        self.assertLess(signing.index('server_deploy.py'),signing.index('pipeline.py promote-channel'))
        self.assertNotIn('  publish:',workflow)
        self.assertIn('timeout-minutes: 330', signing)
        self.assertIn('timeout-minutes: 315', recovery)
        self.assertIn('python\" -u automation/scripts/custom-release/server_deploy.py', recovery)


if __name__ == '__main__': unittest.main()
