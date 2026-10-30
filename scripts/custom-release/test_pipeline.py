"""运行 python3 scripts/custom-release/test_pipeline.py；Git 测试全程使用临时本地仓库。"""
import argparse
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pipeline', Path(__file__).with_name('pipeline.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.env = patch.dict(os.environ, {
            'GH_TOKEN': 'dummy-test-token', 'GITHUB_REPOSITORY': 'Example/fork',
            'GITHUB_RUN_NUMBER': '42', 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
            'GITHUB_OUTPUT': str(self.root / 'output'), 'RUNNER_TEMP': str(self.root),
        })
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temporary.cleanup()

    def args(self, **values):
        return argparse.Namespace(root=str(self.root / 'source'), metadata=str(self.root / 'metadata.json'),
                                  branch='codex/html-embed', force=False, destination=str(self.root / 'packages'), **values)

    def commit(self, directory, name, content):
        file = directory / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)
        p.run('git', 'add', name, cwd=directory)
        p.run('git', 'commit', '-m', name, cwd=directory)

    def repositories(self, conflict=False):
        upstream = self.root / 'upstream'
        upstream.mkdir()
        p.run('git', 'init', '-b', 'dev', cwd=upstream)
        for key, value in [('user.email', 'test@example.invalid'), ('user.name', 'Test')]:
            p.run('git', 'config', key, value, cwd=upstream)
        self.commit(upstream, 'src-tauri/tauri.conf.json', json.dumps({'version': '0.39.1'}))
        self.commit(upstream, 'shared.txt', 'base\n')
        source = self.root / 'source'
        p.run('git', 'clone', str(upstream), str(source))
        for key, value in [('user.email', 'test@example.invalid'), ('user.name', 'Test')]:
            p.run('git', 'config', key, value, cwd=source)
        p.run('git', 'checkout', '-b', 'codex/html-embed', cwd=source)
        self.commit(source, 'shared.txt' if conflict else 'extension.txt', 'custom\n')
        self.commit(upstream, 'shared.txt' if conflict else 'upstream.txt', 'upstream\n')
        remote = self.root / 'fork.git'
        p.run('git', 'init', '--bare', str(remote))
        p.run('git', 'config', f'url.{upstream.as_uri()}.insteadOf', 'https://github.com/codexu/note-gen.git', cwd=source)
        p.run('git', 'config', f'url.{remote.as_uri()}.insteadOf', 'https://github.com/Example/fork.git', cwd=source)
        return source, upstream, remote

    def test_clean_merge_keeps_both_sides_and_does_not_advance_custom_branch_remotely(self):
        source, upstream, remote = self.repositories()
        base = p.run('git', 'rev-parse', 'HEAD', cwd=source).stdout.strip()
        with patch.object(p, 'api', return_value=None):
            p.prepare(self.args())
        data = p.load(self.root / 'metadata.json')
        self.assertEqual(data['custom_sha'], base)
        self.assertEqual(data['upstream_sha'], p.run('git', 'rev-parse', 'HEAD', cwd=upstream).stdout.strip())
        self.assertEqual((source / 'extension.txt').read_text(), 'custom\n')
        self.assertEqual((source / 'upstream.txt').read_text(), 'upstream\n')
        refs = p.run('git', 'for-each-ref', '--format=%(refname)', cwd=remote).stdout.splitlines()
        self.assertEqual(refs, ['refs/heads/codex/ci-build-123-1'])
        self.assertIn('changed=true', (self.root / 'output').read_text())

    def test_conflict_reports_paths_aborts_merge_and_never_pushes(self):
        source, _, remote = self.repositories(conflict=True)
        before = p.run('git', 'rev-parse', 'HEAD', cwd=source).stdout
        with patch.object(p, 'api', return_value=None), self.assertRaises(p.PipelineError):
            p.prepare(self.args())
        self.assertEqual(p.load(self.root / 'metadata.json')['conflicts'], ['shared.txt'])
        self.assertEqual(p.run('git', 'rev-parse', 'HEAD', cwd=source).stdout, before)
        self.assertEqual(p.run('git', 'status', '--porcelain', cwd=source).stdout, '')
        self.assertEqual(p.run('git', 'for-each-ref', cwd=remote).stdout, '')

    def test_published_pair_skips_but_a_draft_does_not(self):
        source, _, _ = self.repositories()
        with patch.object(p, 'api', return_value={'draft': False}):
            p.prepare(self.args())
        self.assertNotIn('changed=true', (self.root / 'output').read_text())
        with patch.object(p, 'api', return_value={'draft': True}):
            p.prepare(self.args())
        self.assertTrue((source / 'upstream.txt').is_file())

    def test_configuration_is_an_overlay_bound_to_candidate_sha(self):
        source, _, _ = self.repositories()
        sha = p.run('git', 'rev-parse', 'HEAD', cwd=source).stdout.strip()
        original = (source / 'src-tauri/tauri.conf.json').read_bytes()
        metadata = {'candidate_sha': sha, 'version': '0.39.1-custom.42', 'android_version_code': 1000000042, 'run_number': 42}
        p.save(self.root / 'metadata.json', metadata)
        p.configure(self.args())
        overlay = p.load(source / 'src-tauri/tauri.custom-ci.json')
        self.assertFalse(overlay['bundle']['createUpdaterArtifacts'])
        self.assertEqual(overlay['plugins']['updater']['endpoints'], [])
        self.assertEqual(overlay['bundle']['android']['versionCode'], 1000000042)
        self.assertEqual((source / 'src-tauri/tauri.conf.json').read_bytes(), original)
        metadata['candidate_sha'] = 'wrong'
        p.save(self.root / 'metadata.json', metadata)
        with self.assertRaises(p.PipelineError):
            p.configure(self.args())

    def test_build_versions_and_android_bounds(self):
        self.assertEqual(p.build_numbers('0.40.0-beta.1', 42), ('0.40.0-custom.42', 1000000042))
        for number in [0, -1, 1000000001]:
            with self.assertRaises(p.PipelineError):
                p.build_numbers('0.39.1', number)

    def test_android_regeneration_restores_custom_files_and_adaptive_icon_colors(self):
        source, _, _ = self.repositories()
        self.commit(source, 'src-tauri/gen/android/app/build.gradle.kts', 'tracked custom Gradle')
        icons = self.root / 'icons'
        real_run = p.run
        def fake_tool(*args, **kwargs):
            if args[:3] == ('pnpm', 'tauri', 'android'):
                target = source / 'src-tauri/gen/android/app/build.gradle.kts'
                target.parent.mkdir(parents=True)
                target.write_text('generated Gradle')
                return None
            if args[:3] == ('pnpm', 'tauri', 'icon'):
                for name in ['values/ic_launcher_background.xml', 'mipmap-anydpi-v26/ic_launcher.xml']:
                    target = icons / 'android' / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text('icon resource')
                return None
            return real_run(*args, **kwargs)
        with patch.dict(os.environ, CI='true'), patch.object(p, 'run', side_effect=fake_tool):
            p.prepare_android(self.args(icons=str(icons)))
        self.assertEqual((source / 'src-tauri/gen/android/app/build.gradle.kts').read_text(), 'tracked custom Gradle')
        self.assertTrue((source / 'src-tauri/gen/android/app/src/main/res/values/ic_launcher_background.xml').is_file())

    def test_windows_requires_x64_binary(self):
        binary = self.root / 'note-gen.exe'
        header = bytearray(128)
        header[:2] = b'MZ'
        struct.pack_into('<I', header, 0x3c, 80)
        header[80:84] = b'PE\x00\x00'
        struct.pack_into('<H', header, 84, 0x8664)
        binary.write_bytes(header)
        p.check_windows(binary)
        struct.pack_into('<H', header, 84, 0x014c)
        binary.write_bytes(header)
        with self.assertRaises(p.PipelineError):
            p.check_windows(binary)

    def packages(self):
        directory = self.root / 'packages'
        directory.mkdir()
        for suffix in ['windows-x64-setup.exe', 'macos-arm64.dmg', 'android-arm64.apk']:
            (directory / ('NoteGen_0.39.1-custom.42_' + suffix)).write_bytes(b'test-package')
        metadata = {'version': '0.39.1-custom.42', 'candidate_sha': 'a' * 40, 'custom_sha': 'b' * 40,
                    'upstream_sha': 'c' * 40, 'tag': 'custom-dev-utest-stest', 'run_url': 'https://example.invalid/run'}
        p.save(self.root / 'metadata.json', metadata)
        return directory

    def test_partial_or_unsigned_packages_cannot_be_published(self):
        directory = self.packages()
        p.release_files(directory)
        next(directory.glob('*.apk')).rename(directory / 'android-arm64-unsigned.apk')
        with self.assertRaises(p.PipelineError):
            p.release_files(directory)

    def publish_simulation(self, incomplete=False, published=False, draft=False, dangling=False):
        directory = self.packages()
        uploads, events = [], []

        def fake_api(method, endpoint, data=None):
            events.append((method, endpoint, data))
            if method == 'GET' and '/releases/tags/' in endpoint:
                return {'id': 7, 'draft': draft} if published or draft else None
            if method == 'GET' and '/git/ref/tags/' in endpoint:
                return {'ref': 'test-tag'} if draft or dangling else None
            if method == 'POST':
                self.assertTrue(data['draft'])
                return {'id': 8, 'upload_url': 'https://uploads.github.com/assets{?name}', 'html_url': 'https://example.invalid/release'}
            if endpoint.endswith('/assets'):
                names = uploads[:-1] if incomplete else uploads
                return [{'name': name, 'size': (directory / name).stat().st_size} for name in names]
            return None

        def upload(request, timeout):
            self.assertFalse(any(method == 'PATCH' for method, _, _ in events))
            uploads.append(p.urllib.parse.parse_qs(p.urllib.parse.urlparse(request.full_url).query)['name'][0])
            return io.BytesIO(b'{}')

        with patch.object(p, 'api', side_effect=fake_api), patch.object(p.urllib.request, 'urlopen', side_effect=upload):
            if incomplete or published or dangling:
                with self.assertRaises(p.PipelineError):
                    p.publish(self.args())
                self.assertFalse(any(method == 'PATCH' for method, _, _ in events))
            else:
                p.publish(self.args())
                self.assertEqual(len(uploads), 5)
                self.assertEqual(events[-1][2]['draft'], False)
                self.assertEqual(events[-1][2]['make_latest'], 'false')
                if draft:
                    self.assertEqual([endpoint for method, endpoint, _ in events if method == 'DELETE'],
                                     ['repos/Example/fork/releases/7', 'repos/Example/fork/git/refs/tags/custom-dev-utest-stest'])

    def test_release_publishes_only_after_all_assets_are_uploaded(self):
        self.publish_simulation()

    def test_incomplete_upload_leaves_release_unpublished(self):
        self.publish_simulation(incomplete=True)

    def test_published_release_is_never_overwritten(self):
        self.publish_simulation(published=True)

    def test_incomplete_draft_and_its_tag_can_be_recovered(self):
        self.publish_simulation(draft=True)

    def test_existing_tag_without_draft_is_not_overwritten(self):
        self.publish_simulation(dangling=True)

    def test_signing_failure_removes_private_key(self):
        os.environ['ANDROID_KEYSTORE_BASE64'] = base64.b64encode(b'fake-private-key').decode()
        p.save(self.root / 'metadata.json', {})
        with patch.object(p, 'verify_apk', return_value=self.root), patch.object(p, 'run', side_effect=p.PipelineError('sign failed')):
            with self.assertRaises(p.PipelineError):
                p.sign_android(self.args(apk='unsigned.apk'))
        self.assertFalse((self.root / 'custom-release.keystore').exists())
        del os.environ['ANDROID_KEYSTORE_BASE64']

    def test_signing_aligns_to_16k_before_signing_and_never_passes_password_arguments(self):
        p.save(self.root / 'metadata.json', {'version': '0.39.1-custom.42'})
        environment = {'ANDROID_KEYSTORE_BASE64': base64.b64encode(b'test-key').decode(),
                       'ANDROID_KEYSTORE_PASSWORD': 'secret-store-password', 'ANDROID_KEY_PASSWORD': 'secret-key-password'}
        with patch.dict(os.environ, environment), patch.object(p, 'verify_apk', return_value=self.root), patch.object(p, 'run') as run:
            p.sign_android(self.args(apk='unsigned.apk'))
        calls = [call.args for call in run.call_args_list]
        self.assertEqual(calls[0][1:6], ('-P', '16', '-f', '4', 'unsigned.apk'))
        self.assertEqual(calls[1][1], 'sign')
        self.assertEqual(calls[-1][1:5], ('-c', '-P', '16', '4'))
        self.assertIn('env:ANDROID_KEYSTORE_PASSWORD', calls[1])
        self.assertNotIn('secret-store-password', str(calls))
        self.assertFalse((self.root / 'custom-release.keystore').exists())

    def test_failure_updates_one_issue_and_success_closes_it(self):
        existing = {'title': '[Custom dev builds] Update requires attention', 'number': 9}
        with patch.object(p, 'api', side_effect=lambda method, endpoint, data=None: [existing] if method == 'GET' else None) as api:
            p.notify(self.args(success=False))
            self.assertEqual(api.call_args[0][0], 'PATCH')
            self.assertIn('/issues/9', api.call_args[0][1])
            p.notify(self.args(success=True))
            self.assertEqual(api.call_args[0][2], {'state': 'closed'})

    def test_artifact_cleanup_requires_a_published_release_and_keeps_metadata(self):
        p.save(self.root / 'metadata.json', {'tag': 'custom-test'})
        with patch.object(p, 'api', return_value={'draft': True}), self.assertRaises(p.PipelineError):
            p.cleanup_artifacts(self.args())
        def response(method, endpoint, data=None):
            if '/releases/tags/' in endpoint:
                return {'draft': False}
            if method == 'GET':
                return {'artifacts': [{'id': 1, 'name': 'custom-package-macos-arm64'},
                                      {'id': 2, 'name': 'custom-build-metadata'}, {'id': 3, 'name': 'unrelated'}]}
        with patch.object(p, 'api', side_effect=response) as api:
            p.cleanup_artifacts(self.args())
            deletes = [call.args[1] for call in api.call_args_list if call.args[0] == 'DELETE']
            self.assertEqual(deletes, ['repos/Example/fork/actions/artifacts/1'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
