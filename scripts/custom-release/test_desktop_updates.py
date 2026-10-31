"""签名/渠道推进测试，所有 GitHub 写入由模拟 API 接收。"""
import argparse
import base64
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import desktop_updates as updates
from pipeline import PipelineError


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.packages = self.root / 'packages'
        self.packages.mkdir()
        for suffix in ['windows-x64-setup.exe', 'macos-arm64.dmg', 'macos-arm64.app.tar.gz', 'android-arm64.apk']:
            (self.packages / ('NoteGen_0.39.1-custom.42_' + suffix)).write_bytes(b'package')
        for suffix in ['windows-x64-setup.exe', 'macos-arm64.app.tar.gz']:
            (self.packages / ('NoteGen_0.39.1-custom.42_' + suffix + '.sig')).write_text('signature')
        metadata = {'version': '0.39.1-custom.42', 'tag': 'custom-tag', 'upstream_sha': 'upstream',
                    'custom_sha': 'custom', 'android_version_code': 1000000042}
        (self.root / 'info.json').write_text(json.dumps(metadata))
        self.args = argparse.Namespace(destination=str(self.packages), metadata=str(self.root / 'info.json'))
        self.state = None
        self.draft = False
        self.events = []
        self.env = patch.dict(os.environ, {'GITHUB_REPOSITORY': 'TheFBplus/note-gen'})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def api(self, method, endpoint, data=None):
        self.events.append((method, endpoint, data))
        if method != 'GET': return {}
        if '/releases/tags/' in endpoint:
            return {'id': 1, 'draft': self.draft, 'published_at': '2026-10-31T01:00:00Z'}
        if endpoint.endswith('/assets'):
            return [{'name': f.name, 'size': f.stat().st_size} for f in self.packages.iterdir()]
        if '/contents/' in endpoint:
            return None if self.state is None else {'sha': 'sha', 'content': base64.b64encode(json.dumps(self.state).encode()).decode()}
        if '/git/ref/' in endpoint: return {'object': {'sha': 'source-sha'}}
        raise AssertionError(endpoint)

    def promote(self):
        with patch.object(updates, 'api', side_effect=self.api):
            updates.promote(self.args)

    def test_published_complete_release_advances_once(self):
        self.promote()
        writes = [e for e in self.events if e[0] == 'PUT']
        self.assertEqual(len(writes), 1)
        payload = writes[0][2]
        self.assertEqual(payload['branch'], updates.CHANNEL_BRANCH)
        self.state = json.loads(base64.b64decode(payload['content']))
        self.assertEqual(set(self.state['platforms']), {'windows-x86_64-nsis', 'darwin-aarch64'})
        self.assertIn('/releases/download/custom-tag/', self.state['android']['url'])
        self.events.clear()
        self.promote()
        self.assertFalse(any(e[0] == 'PUT' for e in self.events))

    def test_draft_cannot_advance(self):
        self.draft = True
        with self.assertRaises(PipelineError): self.promote()
        self.assertFalse(any(e[0] != 'GET' for e in self.events))

    def test_missing_signature_cannot_advance(self):
        next(self.packages.glob('*.exe.sig')).unlink()
        with self.assertRaises(PipelineError): self.promote()
        self.assertFalse(any(e[0] == 'PUT' for e in self.events))

    def test_older_version_and_android_version_code_are_rejected(self):
        for version, code in [('0.40.0-custom.1', 1000000041), ('0.39.1-custom.41', 1000000043)]:
            self.state = {'version': version, 'android': {'version_code': code}}
            with self.assertRaises(PipelineError): self.promote()
        self.assertFalse(any(e[0] == 'PUT' for e in self.events))

    def test_release_assets_must_be_fully_uploaded(self):
        original = self.api
        def incomplete(method, endpoint, data=None):
            value = original(method, endpoint, data)
            return value[:-1] if endpoint.endswith('/assets') else value
        with patch.object(updates, 'api', side_effect=incomplete), self.assertRaises(PipelineError):
            updates.promote(self.args)

    def test_channel_write_error_preserves_published_release(self):
        original = self.api
        def failure(method, endpoint, data=None):
            if method == 'PUT': raise PipelineError('network error')
            return original(method, endpoint, data)
        with patch.object(updates, 'api', side_effect=failure), self.assertRaises(PipelineError):
            updates.promote(self.args)
        self.assertFalse(any(e[0] == 'DELETE' for e in self.events))

    def test_signatures_are_verified_against_committed_public_key(self):
        for file in self.packages.iterdir():
            if not (file.name.endswith('.exe') or file.name.endswith('.tar.gz')): file.unlink()
        calls = []
        def command(*args):
            calls.append(args)
            if 'signer' in args:
                Path(str(args[-1]) + '.sig').write_text(base64.b64encode(b'untrusted comment: fixture\nsig').decode())
            elif args[0] == 'minisign':
                self.assertTrue(Path(args[args.index('-x') + 1]).read_bytes().startswith(b'untrusted comment:'))
        with patch.dict(os.environ, {'CUSTOM_TAURI_SIGNER': 'trusted-cli'}), patch.object(updates, 'run', side_effect=command):
            updates.sign(self.args)
        self.assertEqual(sum(c[0] == 'minisign' for c in calls), 2)
        self.assertFalse(any('PRIVATE_KEY' in ' '.join(c) for c in calls))


if __name__ == '__main__': unittest.main()
