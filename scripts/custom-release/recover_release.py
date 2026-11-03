"""手动恢复已发布包，仅下载和验签，不构建或执行包内代码。"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import tempfile
from urllib.parse import quote
from urllib.request import urlopen

from desktop_updates import public_key, version_key
from pipeline import PipelineError, api, repository, release_files, run, save


def recover(tag, directory, metadata_path):
    if not re.fullmatch(r'custom-dev-u[a-f0-9]{12}-s[a-f0-9]{12}(?:-r\d+-a\d+)?', tag):
        raise PipelineError('Invalid custom Release tag')
    repo = repository()
    release = api('GET', f'repos/{repo}/releases/tags/{quote(tag, safe="")}')
    if not release or release['draft']:
        raise PipelineError('An existing published custom Release is required')
    assets = api('GET', f'repos/{repo}/releases/{release["id"]}/assets')
    if len(assets) != 8:
        raise PipelineError('Expected six signed packages, metadata and checksums')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    for asset in assets:
        name = asset['name']
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', name) or asset['size'] > 1024**3:
            raise PipelineError('Unsafe Release asset')
        if not asset['browser_download_url'].startswith(f'https://github.com/{repo}/releases/download/{tag}/'):
            raise PipelineError('Unexpected Release asset URL')
        expected = asset.get('digest', '')
        if not expected.startswith('sha256:'):
            raise PipelineError('GitHub asset SHA256 is required for recovery')
        value = hashlib.sha256()
        count = 0
        with urlopen(asset['browser_download_url'], timeout=120) as response, (directory / name).open('xb') as output:
            for chunk in iter(lambda: response.read(1024 * 1024), b''):
                count += len(chunk)
                if count > asset['size']: raise PipelineError('Release asset size mismatch')
                output.write(chunk)
                value.update(chunk)
        if count != asset['size'] or 'sha256:' + value.hexdigest() != expected:
            raise PipelineError('Release asset digest mismatch')
    metadata = json.loads((directory / 'build-info.json').read_text())
    version_key(metadata['version'])
    if metadata['tag'] != tag or metadata['repository'] != repo:
        raise PipelineError('Release provenance mismatch')
    prefix = 'NoteGen_' + metadata['version'] + '_'
    if any(not file.name.startswith(prefix) for file in directory.iterdir() if file.name not in {'build-info.json', 'SHA256SUMS.txt'}):
        raise PipelineError('Package filename does not match Release version')
    recorded = {}
    for line in (directory / 'SHA256SUMS.txt').read_text().splitlines():
        checksum, name = line.split('  ', 1)
        if name in recorded or not re.fullmatch('[a-f0-9]{64}', checksum):
            raise PipelineError('Invalid checksum list')
        recorded[name] = checksum
    from pipeline import digest
    if recorded != {file.name: digest(file) for file in directory.iterdir() if file.name != 'SHA256SUMS.txt'}:
        raise PipelineError('Release checksum list mismatch')
    # 完整包集合及固定桌面公钥验证，不能仅信任校验文件中的摘要。
    import shutil
    with tempfile.TemporaryDirectory() as temporary:
        for file in directory.iterdir():
            if file.name not in {'build-info.json', 'SHA256SUMS.txt'}:
                shutil.copyfile(file, Path(temporary) / file.name)
        release_files(temporary)
    key = base64.b64decode(public_key()).decode().strip().splitlines()[-1]
    for suffix in ['_windows-x64-setup.exe', '_macos-arm64.app.tar.gz']:
        file = next(directory.glob('*' + suffix))
        with tempfile.TemporaryDirectory() as temporary:
            signature = Path(temporary) / 'signature'
            signature.write_bytes(base64.b64decode(Path(str(file) + '.sig').read_text().strip(), validate=True))
            run('minisign', '-Vm', str(file), '-x', str(signature), '-P', key)
    save(metadata_path, metadata)
    print('Existing Release downloaded and verified:', metadata['version'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--tag', required=True)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--metadata', required=True)
    args = parser.parse_args()
    recover(args.tag, args.destination, args.metadata)
