#!/usr/bin/env python3
"""使用模拟 API 验证提醒行为，不写入真实 GitHub 仓库。"""
import base64
import json
import os
import unittest
from unittest.mock import patch

from pipeline import PipelineError
from watch_upstream import STATE_BRANCH, check, pages


def release(number, **overrides):
    return dict(id=number, tag_name=f'v{number}.0.0', draft=False, prerelease=False,
                published_at=f'2026-10-{number:02d}T00:00:00Z', **overrides)


class FakeGitHub:
    def __init__(self):
        self.releases = [release(1)]
        self.state = None
        self.issues = []
        self.writes = []
        self.fail_save = False

    def __call__(self, method, endpoint, data=None):
        if method == 'GET':
            if endpoint.startswith('repos/codexu/note-gen/releases?'):
                return self.releases
            if '/contents/' in endpoint:
                return None if self.state is None else {
                    'sha': 'state-sha', 'content': base64.b64encode(json.dumps(self.state).encode()).decode()}
            if '/issues?' in endpoint:
                return self.issues
            if '/git/ref/heads/' in endpoint:
                return None if endpoint.endswith(STATE_BRANCH) else {'object': {'sha': 'default-sha'}}
            if endpoint == 'repos/TheFBplus/note-gen':
                return {'default_branch': 'codex/html-embed'}
            raise AssertionError(endpoint)
        self.writes.append((method, endpoint, data))
        if '/issues' in endpoint:
            self.issues.append(dict(data, number=len(self.issues) + 1))
        elif '/contents/' in endpoint:
            if self.fail_save:
                raise PipelineError('simulated state save failure')
            self.state = json.loads(base64.b64decode(data['content']))
        elif not endpoint.endswith('/git/refs'):
            raise AssertionError(endpoint)
        return {}


@patch.dict(os.environ, {'GITHUB_REPOSITORY': 'TheFBplus/note-gen'})
class ReminderTests(unittest.TestCase):
    def test_first_run_baselines_and_unchanged_run_does_not_write(self):
        github = FakeGitHub()
        check(github)
        self.assertEqual(github.state['seen_release_ids'], [1])
        self.assertEqual(github.issues, [])
        github.writes.clear()
        check(github)
        self.assertEqual(github.writes, [])

    def test_new_release_and_closed_issue_not_repeated(self):
        github = FakeGitHub()
        check(github)
        github.releases += [release(2)]
        check(github)
        self.assertEqual(len(github.issues), 1)
        self.assertIn('最新的上游 dev', github.issues[0]['body'])
        github.issues[0]['state'] = 'closed'
        check(github)
        self.assertEqual(len(github.issues), 1)

    def test_draft_prerelease_and_promotion(self):
        github = FakeGitHub()
        github.releases += [dict(release(2), draft=True), dict(release(3), prerelease=True)]
        check(github)
        self.assertEqual(github.state['seen_release_ids'], [1])
        github.releases[2]['prerelease'] = False
        check(github)
        self.assertEqual(len(github.issues), 1)
        self.assertEqual(github.state['seen_release_ids'], [1, 3])

    def test_state_save_failure_reuses_existing_issue(self):
        github = FakeGitHub()
        check(github)
        github.releases += [release(2)]
        github.fail_save = True
        with self.assertRaises(PipelineError):
            check(github)
        github.fail_save = False
        github.issues[0]['state'] = 'closed'
        check(github)
        self.assertEqual(len(github.issues), 1)
        self.assertEqual(github.state['seen_release_ids'], [1, 2])

    def test_multiple_new_releases_and_deleted_release_id_retained(self):
        github = FakeGitHub()
        check(github)
        github.releases = [release(3), release(2)]
        check(github)
        self.assertEqual([i['title'] for i in github.issues], [
            '[Upstream release] NoteGen v2.0.0', '[Upstream release] NoteGen v3.0.0'])
        self.assertEqual(github.state['seen_release_ids'], [1, 2, 3])

    def test_invalid_state_fails_without_reset(self):
        github = FakeGitHub()
        github.state = {'schema_version': 99}
        with self.assertRaises(PipelineError):
            check(github)
        self.assertEqual(github.writes, [])

    def test_pagination_and_missing_api_result(self):
        calls = []
        def request(method, endpoint):
            calls.append(endpoint)
            return list(range(100)) if endpoint.endswith('&page=1') else [100]
        self.assertEqual(len(list(pages('releases', request))), 101)
        self.assertEqual(len(calls), 2)
        with self.assertRaises(PipelineError):
            list(pages('missing', lambda *args: None))


if __name__ == '__main__':
    unittest.main()
