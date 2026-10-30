#!/usr/bin/env python3
"""检查上游正式发布；持久状态留在专用分支，不合并源码、不触发构建。"""
import base64
import json
import os
from urllib.parse import quote

from pipeline import PipelineError, api, repository

UPSTREAM = 'codexu/note-gen'
STATE_BRANCH = 'codex/upstream-release-state'
STATE_PATH = 'upstream-release-state.json'


def pages(endpoint, request):
    page = 1
    while True:
        batch = request('GET', f'{endpoint}{"&" if "?" in endpoint else "?"}per_page=100&page={page}')
        # 不把 API 404 当作空列表，否则可能错误初始化或重复提醒。
        if not isinstance(batch, list):
            raise PipelineError('Expected GitHub API list: ' + endpoint)
        yield from batch
        if len(batch) < 100:
            return
        page += 1


def check(request=api):
    repo = repository()
    releases = [r for r in pages(f'repos/{UPSTREAM}/releases', request)
                if not r['draft'] and not r['prerelease']]
    endpoint = f'repos/{repo}/contents/{STATE_PATH}'
    stored = request('GET', endpoint + '?ref=' + quote(STATE_BRANCH, safe=''))
    if stored is None:
        # 首次运行只建立基线，不为历史发布发送通知。分支不是构建来源。
        state = {'schema_version': 1, 'upstream': UPSTREAM, 'seen_release_ids': []}
        pending = []
    else:
        state = json.loads(base64.b64decode(stored['content']))
        if (state.get('schema_version') != 1 or state.get('upstream') != UPSTREAM
                or not isinstance(state.get('seen_release_ids'), list)
                or any(type(v) is not int for v in state['seen_release_ids'])):
            raise PipelineError('Invalid reminder state; refusing to reset baseline')
        seen = set(state['seen_release_ids'])
        pending = [r for r in releases if r['id'] not in seen]

    if pending:
        # 包含已关闭 Issue；发 Issue 后写状态失败时，重跑也不重复通知。
        issues = list(pages(f'repos/{repo}/issues?state=all&creator=github-actions%5Bbot%5D', request))
        for release in sorted(pending, key=lambda r: (r['published_at'], r['id'])):
            marker = f'<!-- upstream-release:{UPSTREAM}:{release["id"]} -->'
            if any(marker in (i.get('body') or '') for i in issues if 'pull_request' not in i):
                continue
            tag = release['tag_name']
            link = f'https://github.com/{UPSTREAM}/releases/tag/{quote(tag, safe="")}'
            body = (f'{marker}\n上游 NoteGen 有新的正式发布。\n\n'
                    f'- 版本：`{tag}`\n- 发布时间（UTC）：{release["published_at"]}\n'
                    f'- [查看上游 Release]({link})\n'
                    f'- [手动启动定制构建](https://github.com/{repo}/actions/workflows/custom-dev-build.yml)\n\n'
                    '此提醒不会合并、打包或安装任何内容。需要构建时，请选择 '
                    '`Custom dev packages` → `Run workflow`，分支选择 `codex/html-embed`。\n\n'
                    '注意：手动构建获取运行时最新的上游 dev，可能包含此正式发布之后的开发改动；'
                    '不保证与该 Release 的代码完全相同。')
            request('POST', f'repos/{repo}/issues', {
                'title': f'[Upstream release] NoteGen {tag}'[:256], 'body': body})
            print('Created reminder for release ID', release['id'])

    # 保留已删除发布的 ID，避免重新出现时重复提醒。
    ids = sorted(set(state['seen_release_ids']) | {r['id'] for r in releases})
    if stored is not None and ids == state['seen_release_ids']:
        print('No new formal releases; no state changes.')
        return
    state['seen_release_ids'] = ids
    if stored is None:
        ref = request('GET', f'repos/{repo}/git/ref/heads/{STATE_BRANCH}')
        if ref is None:
            info = request('GET', f'repos/{repo}')
            default = request('GET', f'repos/{repo}/git/ref/heads/{info["default_branch"]}')
            request('POST', f'repos/{repo}/git/refs', {
                'ref': 'refs/heads/' + STATE_BRANCH, 'sha': default['object']['sha']})
    payload = {
        'message': 'chore: record upstream release reminder state', 'branch': STATE_BRANCH,
        'content': base64.b64encode((json.dumps(state, indent=2) + '\n').encode()).decode(),
    }
    if stored is not None:
        payload['sha'] = stored['sha']
    request('PUT', endpoint, payload)
    print('Saved reminder state.' if stored else 'Initialized baseline; historical releases were not notified.')


if __name__ == '__main__':
    if repository() != 'TheFBplus/note-gen':
        raise SystemExit('This reminder is scoped to TheFBplus/note-gen')
    check()
