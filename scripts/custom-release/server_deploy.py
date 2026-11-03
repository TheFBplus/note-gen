"""仅通过固定主机密钥的 SFTP 发布；不执行服务器 shell，不接收用户笔记。"""
import argparse
import hashlib
import html
import io
import json
import os
from pathlib import Path
import stat
import tempfile
from urllib.request import Request, HTTPRedirectHandler, build_opener
import uuid

from desktop_updates import build_manifest, version_key
from pipeline import PipelineError, digest

BASE_URL = 'https://files.cheapface.top/notegen-updates/'
HOST = 'files.cheapface.top'
USER = 'notegen-deploy'
ROOT = '/pub'


def connect(key_path):
    import paramiko
    client = paramiko.SSHClient()
    client.load_host_keys(str(Path(__file__).with_name('deploy-known-hosts')))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        client.connect(HOST, port=22, username=USER, key_filename=str(key_path),
                       allow_agent=False, look_for_keys=False, timeout=20, auth_timeout=20, banner_timeout=20)
        sftp = client.open_sftp()
        sftp.get_channel().settimeout(120)
        return client, sftp
    except Exception:
        client.close()
        raise


def read_remote(sftp, path):
    try:
        with sftp.open(path, 'rb') as stream:
            data = stream.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                raise PipelineError('Remote control file exceeds size limit')
            return data
    except FileNotFoundError:
        return None


class TrustedRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if not newurl.startswith(BASE_URL):
            raise PipelineError('Unexpected download redirect')
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def https_digest(url):
    # 不跟随重定向到其他域名，避免服务器配置错误时把校验交给未知镜像。
    with build_opener(TrustedRedirects()).open(Request(url, headers={'Cache-Control': 'no-cache'}), timeout=120) as response:
        if not response.url.startswith(BASE_URL):
            raise PipelineError('Unexpected download redirect')
        value = hashlib.sha256()
        for chunk in iter(lambda: response.read(1024 * 1024), b''):
            value.update(chunk)
        return value.hexdigest()


def server_manifest(manifest):
    # GitHub 保留原渠道；服务器清单中的每个包都指向可直连的版本目录。
    result = json.loads(json.dumps(manifest))
    prefix = BASE_URL + 'releases/' + result['version'] + '/'
    for item in [*result['platforms'].values(), result['android']]:
        item['url'] = prefix + item['url'].rsplit('/', 1)[-1]
    return result


def guard_version(old, manifest):
    if old is None:
        return
    previous = json.loads(old)
    before, after = version_key(previous['version']), version_key(manifest['version'])
    if before > after or (before < after and previous['android']['version_code'] >= manifest['android']['version_code']):
        raise PipelineError('Refusing to downgrade server update channel')
    if before == after and previous != manifest:
        raise PipelineError('Refusing to replace an existing server version')


def index_page(manifest, filenames):
    links = '\n'.join(f'<li><a href="releases/{manifest["version"]}/{name}">{html.escape(name)}</a></li>' for name in sorted(filenames))
    return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>NoteGen 定制版下载</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:16px;line-height:1.8;overflow-wrap:anywhere}</style>'
            f'<h1>NoteGen {html.escape(manifest["version"])}</h1><p>Windows x64、Apple Silicon、Android ARM64。定制开发版，非官方发行版。升级前请备份笔记。</p>'
            f'<ul>{links}</ul><p><a href="{html.escape(manifest["release_url"], quote=True)}">GitHub 备用下载与版本来源</a></p></html>').encode()


def deploy_files(sftp, manifest, files, verify=https_digest):
    version = manifest['version']
    version_key(version)
    if any(not name or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-' for c in name) for name in files):
        raise PipelineError('Unsafe package filename')
    lock = ROOT + '/.notegen-release-lock'
    # 目录创建提供跨运行互斥；异常终止留下锁时由管理员核对后手动移除，不擅自抢锁。
    sftp.mkdir(lock)
    token = uuid.uuid4().hex
    stage = ROOT + '/releases/.stage-' + token
    final = ROOT + '/releases/' + version
    temporary = ROOT + '/.latest-' + token + '.json'
    page = ROOT + '/.index-' + token + '.html'
    staged = False
    try:
        guard_version(read_remote(sftp, ROOT + '/latest.json'), manifest)
        try:
            existing = sftp.lstat(final)
        except FileNotFoundError:
            existing = None
        if existing is not None and not stat.S_ISDIR(existing.st_mode):
            raise PipelineError('Existing release path is not a directory')
        if existing is None:
            sftp.mkdir(stage)
            staged = True
            for name, local in files.items():
                sftp.put(str(local), stage + '/' + name, confirm=True)
                sftp.chmod(stage + '/' + name, 0o644)
            # 标准 rename 不覆盖已有版本目录；不删除或改写旧版本。
            sftp.rename(stage, final)
            staged = False
        for name, local in files.items():
            if verify(BASE_URL + 'releases/' + version + '/' + name) != digest(local):
                raise PipelineError('HTTPS package digest mismatch: ' + name)
        encoded = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
        sftp.putfo(io.BytesIO(encoded), temporary, file_size=len(encoded), confirm=True)
        sftp.chmod(temporary, 0o644)
        if read_remote(sftp, temporary) != encoded:
            raise PipelineError('Uploaded manifest mismatch')
        landing = index_page(manifest, files)
        sftp.putfo(io.BytesIO(landing), page, file_size=len(landing), confirm=True)
        sftp.chmod(page, 0o644)
        sftp.posix_rename(page, ROOT + '/index.html')
        # 必须支持 OpenSSH POSIX 扩展；失败即停止，绝不先删除旧清单再重命名。
        sftp.posix_rename(temporary, ROOT + '/latest.json')
        if verify(BASE_URL + 'latest.json') != hashlib.sha256(encoded).hexdigest():
            raise PipelineError('Server channel committed but HTTPS verification failed; retry publication without rebuilding')
    finally:
        for path in [temporary, page]:
            try: sftp.remove(path)
            except FileNotFoundError: pass
        if staged:
            for name in files:
                try: sftp.remove(stage + '/' + name)
                except FileNotFoundError: pass
            sftp.rmdir(stage)
        sftp.rmdir(lock)


def deploy(args):
    directory = Path(args.destination)
    # 复用已发布 GitHub Release 的完整性与来源检查，拒绝草稿或不匹配产物。
    manifest = server_manifest(build_manifest(args))
    files = {file.name: file for file in directory.iterdir()}
    if any(not file.is_file() or file.is_symlink() for file in files.values()):
        raise PipelineError('Unexpected deployment file')
    with tempfile.TemporaryDirectory(prefix='notegen-deploy-key-') as temporary:
        key = Path(temporary) / 'id_ed25519'
        key.write_text(os.environ['RELEASE_DEPLOY_SSH_KEY'])
        key.chmod(0o600)
        client, sftp = connect(key)
        try:
            deploy_files(sftp, manifest, files)
        finally:
            sftp.close()
            client.close()
    print('Published server update channel:', manifest['version'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--metadata', required=True)
    parser.add_argument('--destination', required=True)
    try:
        deploy(parser.parse_args())
    except Exception as error:
        # 不输出连接对象/私钥；应用包/渠道错误可以在已无密钥的测试中定位。
        print('::error::Server publication failed (' + type(error).__name__ + '). Existing files were not deleted. Check SFTP authorization, host key, HTTPS and channel version.')
        raise SystemExit(1)
