#!/usr/bin/env python3
"""定制构建控制面：合并、来源记录、产物校验和发布，不依赖应用代码。"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile


class PipelineError(Exception):
    pass


def run(*args, cwd=None, check=True, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and result.returncode:
        raise PipelineError(f'{args[0]} failed ({result.returncode}): {result.stderr[-4000:]}')
    return result


def api(method, endpoint, data=None, raw=None, content_type='application/json'):
    token = os.environ['GH_TOKEN']
    body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    request = urllib.request.Request(
        'https://api.github.com/' + endpoint, data=body, method=method,
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                 'Content-Type': content_type, 'X-GitHub-Api-Version': '2022-11-28'},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            value = response.read()
            return json.loads(value) if value else None
    except urllib.error.HTTPError as error:
        if error.code == 404 and method == 'GET':
            return None
        raise PipelineError(f'GitHub API {method} {endpoint}: HTTP {error.code}') from error


def repository():
    value = os.environ['GITHUB_REPOSITORY']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', value):
        raise PipelineError('Invalid repository')
    return value


def output(**values):
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            for key, value in values.items():
                text = str(value).lower() if isinstance(value, bool) else str(value)
                if '\n' in text or '\r' in text:
                    raise PipelineError('Invalid multiline output')
                stream.write(f'{key}={text}\n')


def save(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def build_numbers(version, number):
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?', version)
    if not match or not 1 <= number <= 1_000_000_000:
        raise PipelineError('Unsupported upstream version or build number')
    core = '.'.join(match.groups())
    return f'{core}-custom.{number}', 1_000_000_000 + number


def prepare(args):
    root = Path(args.root).resolve()
    output(changed=False)
    repo = repository()
    base = run('git', 'rev-parse', 'HEAD', cwd=root).stdout.strip()
    run('git', 'fetch', '--no-tags', 'https://github.com/codexu/note-gen.git', 'dev', cwd=root)
    upstream = run('git', 'rev-parse', 'FETCH_HEAD', cwd=root).stdout.strip()
    tag = f'custom-dev-u{upstream[:12]}-s{base[:12]}'
    # 只以已发布版本为跳过依据。失败或草稿不会把同一份源码永久标记为已构建。
    existing = api('GET', f'repos/{repo}/releases/tags/{tag}')
    if existing and not existing['draft'] and not args.force:
        print('The same upstream/custom source pair is already published; skipping.')
        return
    number = int(os.environ['GITHUB_RUN_NUMBER'])
    attempt = int(os.environ['GITHUB_RUN_ATTEMPT'])
    run_id = int(os.environ['GITHUB_RUN_ID'])
    if args.force:
        tag += f'-r{run_id}-a{attempt}'
    branch = f'codex/ci-build-{run_id}-{attempt}'
    metadata = {'repository': repo, 'custom_branch': args.branch, 'custom_sha': base,
                'upstream_sha': upstream, 'tag': tag, 'candidate_branch': branch,
                'run_number': number, 'run_id': run_id, 'run_attempt': attempt,
                'run_url': f'https://github.com/{repo}/actions/runs/{run_id}'}
    save(args.metadata, metadata)
    run('git', 'config', 'user.name', 'github-actions[bot]', cwd=root)
    run('git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com', cwd=root)
    merge = run('git', 'merge', '--no-ff', '--no-edit', upstream, cwd=root, check=False)
    if merge.returncode:
        conflicts = run('git', 'diff', '--name-only', '--diff-filter=U', cwd=root).stdout.splitlines()
        metadata.update(status='merge-conflict' if conflicts else 'merge-failed', conflicts=conflicts)
        save(args.metadata, metadata)
        run('git', 'merge', '--abort', cwd=root, check=False)
        raise PipelineError('Upstream merge failed. Conflicts: ' + ', '.join(conflicts))
    candidate = run('git', 'rev-parse', 'HEAD', cwd=root).stdout.strip()
    config = load(root / 'src-tauri/tauri.conf.json')
    version, code = build_numbers(config['version'], number)
    metadata.update(candidate_sha=candidate, upstream_version=config['version'], version=version,
                    android_version_code=code, status='prepared')
    save(args.metadata, metadata)
    # 凭据仅通过子进程环境传给 Git，不写配置、不放 URL 或日志。
    environment = dict(os.environ, GIT_TERMINAL_PROMPT='0', GIT_CONFIG_COUNT='1',
                       GIT_CONFIG_KEY_0='http.https://github.com/.extraheader',
                       GIT_CONFIG_VALUE_0='AUTHORIZATION: basic ' + base64.b64encode(
                           ('x-access-token:' + os.environ['GH_TOKEN']).encode()).decode())
    run('git', 'push', f'https://github.com/{repo}.git', f'HEAD:refs/heads/{branch}', cwd=root, env=environment)
    output(changed=True, candidate_sha=candidate, candidate_branch=branch, tag=tag,
           version=version, android_version_code=code)


def configure(args):
    root = Path(args.root)
    metadata = load(args.metadata)
    if run('git', 'rev-parse', 'HEAD', cwd=root).stdout.strip() != metadata['candidate_sha']:
        raise PipelineError('Candidate source does not match build metadata')
    # 临时覆盖配置不提交到任何源码分支；不使用上游发布密钥或更新端点。
    save(root / 'src-tauri/tauri.custom-ci.json', {
        'version': metadata['version'],
        'bundle': {'createUpdaterArtifacts': False,
                   'android': {'versionCode': metadata['android_version_code']},
                   'macOS': {'bundleVersion': str(metadata['run_number'])}},
        'plugins': {'updater': {'endpoints': []}},
    })


def prepare_android(args):
    root = Path(args.root).resolve()
    if os.environ.get('CI') != 'true':
        raise PipelineError('Android project regeneration is CI-only')
    # gen/android 大部分被 Git 忽略，初始化后恢复所有已跟踪定制文件，而非硬编码少数文件。
    tracked = run('git', 'ls-files', 'src-tauri/gen/android', cwd=root).stdout.splitlines()
    if not tracked:
        raise PipelineError('Missing tracked Android customizations')
    shutil.rmtree(root / 'src-tauri/gen/android')
    run('pnpm', 'tauri', 'android', 'init', '--ci', '--skip-targets-install', cwd=root)
    run('git', 'restore', '--source=HEAD', '--', *tracked, cwd=root)
    # 生成适配 Android 的图标，不依赖上游发布机上的 ImageMagick。
    run('pnpm', 'tauri', 'icon', 'src-tauri/icons/icon.png', '--output', str(Path(args.icons).resolve()), cwd=root)
    generated = Path(args.icons) / 'android'
    if not generated.is_dir():
        raise PipelineError('Android icons were not generated')
    resources = root / 'src-tauri/gen/android/app/src/main/res'
    for source in generated.iterdir():
        if source.is_dir() and (source.name.startswith('mipmap-') or source.name == 'values'):
            shutil.copytree(source, resources / source.name, dirs_exist_ok=True)


def one(paths):
    paths = list(paths)
    if len(paths) != 1:
        raise PipelineError(f'Expected exactly one artifact, found {len(paths)}')
    return paths[0]


def check_windows(path):
    with open(path, 'rb') as stream:
        if stream.read(2) != b'MZ':
            raise PipelineError('Invalid Windows PE executable')
        stream.seek(0x3c)
        offset = struct.unpack('<I', stream.read(4))[0]
        stream.seek(offset)
        signature = stream.read(4)
        machine = struct.unpack('<H', stream.read(2))[0]
    if signature != b'PE\x00\x00' or machine != 0x8664:
        raise PipelineError('Expected Windows x64 application binary')


def collect(args):
    root, destination = Path(args.root), Path(args.destination)
    metadata = load(args.metadata)
    destination.mkdir(parents=True, exist_ok=True)
    prefix = f'NoteGen_{metadata["version"]}'
    if args.platform == 'windows-x64':
        target = root / 'src-tauri/target/x86_64-pc-windows-msvc/release'
        check_windows(target / 'note-gen.exe')
        source = one((target / 'bundle/nsis').glob('*.exe'))
        filename = prefix + '_windows-x64-setup.exe'
    elif args.platform == 'macos-arm64':
        target = root / 'src-tauri/target/aarch64-apple-darwin/release/bundle'
        app = one((target / 'macos').glob('*.app'))
        for relative in ['Contents/MacOS/note-gen', 'Contents/Resources/resources/ocr/notegen-ocr-vision']:
            if run('lipo', '-archs', str(app / relative)).stdout.strip() != 'arm64':
                raise PipelineError(f'Expected arm64 Mach-O: {relative}')
        source = one((target / 'dmg').glob('*.dmg'))
        filename = prefix + '_macos-arm64.dmg'
    else:
        source = one((root / 'src-tauri/gen/android/app/build/outputs/apk/arm64/release').glob('*-unsigned.apk'))
        verify_apk(source, metadata)
        filename = 'android-arm64-unsigned.apk'
    shutil.copyfile(source, destination / filename)


def verify_apk(path, metadata):
    with zipfile.ZipFile(path) as archive:
        abis = {name.split('/')[1] for name in archive.namelist()
                if name.startswith('lib/') and name.endswith('.so')}
    if abis != {'arm64-v8a'}:
        raise PipelineError(f'Expected only Android ARM64, found {sorted(abis)}')
    tools = Path(os.environ['ANDROID_HOME']) / 'build-tools/36.0.0'
    badging = run(str(tools / 'aapt'), 'dump', 'badging', str(path)).stdout
    if f"versionName='{metadata['version']}'" not in badging or f"versionCode='{metadata['android_version_code']}'" not in badging:
        raise PipelineError('APK version does not match the selected build')
    return tools


def sign_android(args):
    metadata = load(args.metadata)
    tools = verify_apk(args.apk, metadata)
    destination = Path(args.destination)
    destination.mkdir(parents=True, exist_ok=True)
    temporary = Path(os.environ['RUNNER_TEMP'])
    keystore, aligned = temporary / 'custom-release.keystore', temporary / 'custom-aligned.apk'
    try:
        keystore.write_bytes(base64.b64decode(os.environ['ANDROID_KEYSTORE_BASE64'], validate=True))
        keystore.chmod(0o600)
        run(str(tools / 'zipalign'), '-P', '16', '-f', '4', args.apk, str(aligned))
        output_apk = destination / f'NoteGen_{metadata["version"]}_android-arm64.apk'
        run(str(tools / 'apksigner'), 'sign', '--ks', str(keystore),
            '--ks-key-alias', os.environ.get('ANDROID_KEY_ALIAS') or 'notegen-custom',
            '--ks-pass', 'env:ANDROID_KEYSTORE_PASSWORD', '--key-pass', 'env:ANDROID_KEY_PASSWORD',
            '--out', str(output_apk), str(aligned))
        run(str(tools / 'apksigner'), 'verify', '--verbose', str(output_apk))
        run(str(tools / 'zipalign'), '-c', '-P', '16', '4', str(output_apk))
        verify_apk(output_apk, metadata)
    finally:
        keystore.unlink(missing_ok=True)
        aligned.unlink(missing_ok=True)


def release_files(directory):
    files = sorted(Path(directory).iterdir())
    expected = {'_windows-x64-setup.exe', '_macos-arm64.dmg', '_android-arm64.apk'}
    if len(files) != 3 or {next((suffix for suffix in expected if file.name.endswith(suffix)), '') for file in files} != expected:
        raise PipelineError('Publication requires exactly the three verified platform packages')
    if any(not file.is_file() or file.stat().st_size == 0 for file in files):
        raise PipelineError('Missing or empty package')
    return files


def digest(file):
    value = hashlib.sha256()
    with open(file, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def publish(args):
    metadata = load(args.metadata)
    files = release_files(args.destination)
    directory = Path(args.destination)
    save(directory / 'build-info.json', metadata)
    files.append(directory / 'build-info.json')
    checksum = directory / 'SHA256SUMS.txt'
    checksum.write_text(''.join(f'{digest(file)}  {file.name}\n' for file in files), encoding='utf-8')
    files.append(checksum)
    repo, tag = repository(), metadata['tag']
    existing = api('GET', f'repos/{repo}/releases/tags/{tag}')
    if existing:
        if not existing['draft']:
            raise PipelineError('Refusing to overwrite a published release')
        api('DELETE', f'repos/{repo}/releases/{existing["id"]}')
        if api('GET', f'repos/{repo}/git/ref/tags/{tag}'):
            api('DELETE', f'repos/{repo}/git/refs/tags/{tag}')
    elif api('GET', f'repos/{repo}/git/ref/tags/{tag}'):
        raise PipelineError('Refusing to overwrite an existing tag without a draft release')
    body = (f'Custom NoteGen dev build `{metadata["version"]}`\n\n'
            f'- Upstream dev: `{metadata["upstream_sha"]}`\n'
            f'- Custom source: `{metadata["custom_sha"]}`\n'
            f'- Merged candidate: `{metadata["candidate_sha"]}`\n'
            f'- Build: {metadata["run_url"]}\n\n'
            'Windows x64, Apple Silicon, Android ARM64. macOS/Windows packages are not publisher-signed; '
            'Android uses your persistent custom key. This is a dev prerelease, not an official NoteGen release. '
            'Install manually; official update checks are disabled in this build. Back up your notes/settings before upgrading.')
    # 先上传到草稿，校验所有文件都已存在后才公开；部分成功不会成为新版本。
    release = api('POST', f'repos/{repo}/releases', {'tag_name': tag, 'target_commitish': metadata['candidate_sha'],
                  'name': f'NoteGen Custom {metadata["version"]}', 'body': body, 'draft': True, 'prerelease': True})
    for file in files:
        endpoint = release['upload_url'].split('{')[0] + '?name=' + urllib.parse.quote(file.name)
        request = urllib.request.Request(endpoint, data=file.read_bytes(), method='POST', headers={
            'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Content-Type': 'application/octet-stream'})
        with urllib.request.urlopen(request, timeout=300) as response:
            json.load(response)
    uploaded = api('GET', f'repos/{repo}/releases/{release["id"]}/assets')
    if {item['name']: item['size'] for item in uploaded} != {file.name: file.stat().st_size for file in files}:
        raise PipelineError('Release assets are incomplete; leaving release as draft')
    api('PATCH', f'repos/{repo}/releases/{release["id"]}', {'draft': False, 'prerelease': True, 'make_latest': 'false'})
    output(release_url=release['html_url'])


def notify(args):
    repo = repository()
    title = '[Custom dev builds] Update requires attention'
    issues = api('GET', f'repos/{repo}/issues?state=open&creator=github-actions%5Bbot%5D&per_page=100') or []
    existing = next((item for item in issues if item['title'] == title and 'pull_request' not in item), None)
    if args.success:
        if existing:
            api('PATCH', f'repos/{repo}/issues/{existing["number"]}', {'state': 'closed'})
        return
    metadata = load(args.metadata) if Path(args.metadata).is_file() else {}
    body = f'Custom dev update failed. Previous published packages are unchanged.\n\nRun: https://github.com/{repo}/actions/runs/{os.environ["GITHUB_RUN_ID"]}\n\n'
    body += 'Job results:\n```json\n' + os.environ.get('JOB_RESULTS', '{}') + '\n```\n'
    if metadata.get('conflicts'):
        body += '\nMerge conflicts:\n' + ''.join(f'- `{path}`\n' for path in metadata['conflicts'])
    if existing:
        api('PATCH', f'repos/{repo}/issues/{existing["number"]}', {'body': body})
    else:
        api('POST', f'repos/{repo}/issues', {'title': title, 'body': body})


def cleanup_artifacts(args):
    repo = repository()
    metadata = load(args.metadata)
    release = api('GET', f'repos/{repo}/releases/tags/{metadata["tag"]}')
    if not release or release['draft']:
        raise PipelineError('Cannot remove artifacts before successful publication')
    artifacts = api('GET', f'repos/{repo}/actions/runs/{os.environ["GITHUB_RUN_ID"]}/artifacts?per_page=100')
    names = {'custom-package-windows-x64', 'custom-package-macos-arm64',
             'custom-package-android-arm64', 'custom-android-unsigned'}
    for item in artifacts['artifacts']:
        if item['name'] in names:
            api('DELETE', f'repos/{repo}/actions/artifacts/{item["id"]}')


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ['prepare', 'configure', 'android-init', 'collect', 'sign-android', 'publish', 'notify', 'cleanup-artifacts']:
        item = sub.add_parser(command)
        item.add_argument('--root', default='.')
        item.add_argument('--metadata', default='build-info.json')
        item.add_argument('--destination', default='dist-custom')
        if command == 'prepare':
            item.add_argument('--branch', default='codex/html-embed')
            item.add_argument('--force', action='store_true')
        if command == 'android-init':
            item.add_argument('--icons', required=True)
        if command == 'collect':
            item.add_argument('--platform', choices=['windows-x64', 'macos-arm64', 'android-arm64'], required=True)
        if command == 'sign-android':
            item.add_argument('--apk', required=True)
        if command == 'notify':
            item.add_argument('--success', action='store_true')
    args = parser.parse_args()
    functions = {'prepare': prepare, 'configure': configure, 'android-init': prepare_android, 'collect': collect,
                 'sign-android': sign_android, 'publish': publish, 'notify': notify, 'cleanup-artifacts': cleanup_artifacts}
    try:
        functions[args.command](args)
    except (PipelineError, OSError, ValueError, KeyError) as error:
        print(f'::error::{error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
