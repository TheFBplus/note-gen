"""桌面更新签名及发布后的渠道推进；只由可信自动化执行。"""
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import quote

from pipeline import PipelineError, api, digest, load, repository, run

CHANNEL_BRANCH = 'codex/custom-update-channel'
CHANNEL_URL = 'https://raw.githubusercontent.com/TheFBplus/note-gen/refs/heads/codex/custom-update-channel/latest.json'


def public_key():
    return Path(__file__).with_name('updater-public-key.txt').read_text().strip()


def sign(args):
    directory = Path(args.destination)
    files = sorted(directory.iterdir())
    suffixes = {'_windows-x64-setup.exe', '_macos-arm64.app.tar.gz'}
    if len(files) != 2 or {next((s for s in suffixes if f.name.endswith(s)), '') for f in files} != suffixes:
        raise PipelineError('Expected exactly Windows installer and macOS updater archive')
    # Tauri 私钥仅通过子进程环境传入，签名阶段不执行候选仓库脚本。
    executable = os.environ['CUSTOM_TAURI_SIGNER']
    key = base64.b64decode(public_key()).decode().strip().splitlines()[-1]
    for file in files:
        run(executable, 'signer', 'sign', str(file))
        # Tauri .sig 是完整 minisign 文本的 Base64 包装，minisign 需解码后验证。
        with tempfile.TemporaryDirectory() as temporary:
            signature = Path(temporary) / 'update.minisig'
            signature.write_bytes(base64.b64decode(Path(str(file) + '.sig').read_text().strip(), validate=True))
            run('minisign', '-Vm', str(file), '-x', str(signature), '-P', key)


def version_key(version):
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)-custom\.(\d+)', version)
    if not match:
        raise PipelineError('Invalid custom version')
    return tuple(map(int, match.groups()))


def promote(args):
    repo, metadata = repository(), load(args.metadata)
    directory = Path(args.destination)
    tag, version = metadata['tag'], metadata['version']
    version_key(version)
    release = api('GET', f'repos/{repo}/releases/tags/{quote(tag, safe="")}')
    if not release or release['draft']:
        raise PipelineError('Cannot advance channel before Release publication')
    assets = {a['name']: a for a in api('GET', f'repos/{repo}/releases/{release["id"]}/assets')}
    files = list(directory.iterdir())
    if any(f.name not in assets or assets[f.name]['size'] != f.stat().st_size for f in files):
        raise PipelineError('Channel assets do not match published Release')
    for file in files:
        recorded = assets[file.name].get('digest')
        if recorded and recorded != 'sha256:' + digest(file):
            raise PipelineError('Published asset digest mismatch')
    def item(suffix):
        selected = [f for f in files if f.name.endswith(suffix)]
        if len(selected) != 1:
            raise PipelineError('Missing or duplicate channel asset: ' + suffix)
        return selected[0]
    def url(file):
        return f'https://github.com/{repo}/releases/download/{quote(tag, safe="")}/{quote(file.name)}'
    platforms = {}
    for target, suffix in [('windows-x86_64-nsis', '_windows-x64-setup.exe'),
                           ('darwin-aarch64', '_macos-arm64.app.tar.gz')]:
        file = item(suffix)
        signature = item(suffix + '.sig').read_text().strip()
        platforms[target] = {'url': url(file), 'signature': signature}
    apk = item('_android-arm64.apk')
    manifest = {'version': version, 'pub_date': release['published_at'] or datetime.now(timezone.utc).isoformat(),
                'notes': f'NoteGen Custom {version}\nUpstream: {metadata["upstream_sha"]}\nCustom: {metadata["custom_sha"]}',
                'platforms': platforms,
                'android': {'url': url(apk), 'version_code': metadata['android_version_code'], 'sha256': digest(apk)},
                'release_url': f'https://github.com/{repo}/releases/tag/{quote(tag, safe="")}'}
    endpoint = f'repos/{repo}/contents/latest.json'
    stored = api('GET', endpoint + '?ref=' + quote(CHANNEL_BRANCH, safe=''))
    if stored:
        old = json.loads(base64.b64decode(stored['content']))
        if version_key(old['version']) > version_key(version):
            raise PipelineError('Refusing to downgrade update channel')
        if version_key(old['version']) == version_key(version):
            if old['release_url'] != manifest['release_url']:
                raise PipelineError('Refusing to replace an existing channel version')
            return
        if old['android']['version_code'] >= manifest['android']['version_code']:
            raise PipelineError('Android versionCode must increase')
    else:
        if not api('GET', f'repos/{repo}/git/ref/heads/{CHANNEL_BRANCH}'):
            info = api('GET', f'repos/{repo}')
            ref = api('GET', f'repos/{repo}/git/ref/heads/{info["default_branch"]}')
            api('POST', f'repos/{repo}/git/refs', {'ref': 'refs/heads/' + CHANNEL_BRANCH, 'sha': ref['object']['sha']})
    payload = {'message': f'chore: promote custom update {version}', 'branch': CHANNEL_BRANCH,
               'content': base64.b64encode((json.dumps(manifest, indent=2) + '\n').encode()).decode()}
    if stored:
        payload['sha'] = stored['sha']
    api('PUT', endpoint, payload)
    print('Published custom update channel:', version)
