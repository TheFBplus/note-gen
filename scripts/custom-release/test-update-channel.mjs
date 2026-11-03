// 使用真实 store，模拟原生边界；禁止测试访问网络或实际安装。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { build } = createRequire(path.resolve('package.json'))('esbuild')
const cache = path.resolve('node_modules/.cache')
await mkdir(cache, { recursive: true })
const directory = await mkdtemp(path.join(cache, 'custom-update-'))
const url = 'https://github.com/TheFBplus/note-gen/releases/download/custom-tag/'
const manifest = () => ({ version: '0.39.1-custom.3', notes: 'fixture', pub_date: '2026-10-31T00:00:00Z',
  release_url: 'https://github.com/TheFBplus/note-gen/releases/tag/custom-tag',
  platforms: { 'windows-x86_64-nsis': { url: url + 'installer.exe', signature: 'signature' }, 'darwin-aarch64': { url: url + 'update.tar.gz', signature: 'signature' } },
  android: { url: url + 'NoteGen_android-arm64.apk', version_code: 1000000003, sha256: 'a'.repeat(64) } })
const context = globalThis.__customTest = { os: 'macos', arch: 'aarch64', current: '0.39.1-custom.2',
  settings: { systemProxy: false, proxy: '' }, httpRequests: [], nativeChecks: [], downloads: [], failFetch: false, failNative: false, failDownload: false, candidateVersion: '', status: 200, remote: manifest(), ignored: '', events: [], windows: [], failInstall: false }
context.candidate = (proxy) => ({ version: context.candidateVersion || context.remote.version, close: async () => { context.closed = (context.closed || 0) + 1 },
  download: async (progress) => { context.downloads.push(proxy); if (context.failDownload) throw Error('error sending request for url'); context.events.push('download'); progress({ event: 'Started', data: { contentLength: 10 } }); progress({ event: 'Progress', data: { chunkLength: 10 } }) },
  install: async () => { context.events.push('install'); if (context.failInstall) throw Error('Signature verification failed') } })
const mocks = {
  '@tauri-apps/api/app': 'export const getVersion = async () => c.current',
  '@tauri-apps/api/core': 'export const invoke = async () => { c.events.push("target"); return "windows-x86_64-nsis" }',
  '@tauri-apps/api/webviewWindow': 'export const getAllWebviewWindows = async () => c.windows',
  '@tauri-apps/plugin-os': 'export const platform = () => c.os; export const arch = () => c.arch',
  '@tauri-apps/plugin-http': 'export const fetch = async (url, options) => { if (!url.includes("codex/custom-update-channel/latest.json")) throw Error("Official endpoint called"); c.events.push("fetch"); c.httpRequests.push(options); if(c.onFetch) c.onFetch(); if(c.fetchWait) await c.fetchWait; if(c.failFetch) throw Error("error sending request for url"); return {status:c.status,ok:c.status===200,json:async()=>structuredClone(c.remote)} }',
  '@tauri-apps/plugin-updater': 'export const check = async options => { c.events.push("native-check:"+options.target); c.nativeChecks.push(options); if(c.failNative) throw Error("error sending request for url"); return c.candidate(options.proxy) }',
  '@tauri-apps/plugin-store': 'export const Store = {load:async name=>({get:async key=>name==="store.json" ? c.settings[key] : c.ignored,set:async(_,v)=>{c.ignored=v},save:async()=>{}})}',
  '@tauri-apps/plugin-process': 'export const relaunch = async () => { c.events.push("relaunch") }',
  '@/stores/article': 'export default {getState:()=>({activeFilePath:"note.md",flushAllPendingArticleSaves:async()=>{c.events.push("flush-all")}})}',
  '@/lib/editor-deactivation': 'export const prepareActiveEditorDeactivationDurably = async () => {c.events.push("flush-active");return true}',
}
const plugin = { name: 'native-test-boundary', setup(builder) {
  builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined)
  builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: 'const c=globalThis.__customTest;\n' + mocks[args.path], loader: 'js' }))
} }
try {
  const outfile = path.join(directory, 'custom.mjs')
  await build({ stdin: { contents: "export {default as main} from './src/stores/update'; export {useCustomUpdates as custom} from './src/extensions/custom-updates/store'; export * from './src/extensions/custom-updates/protocol'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true,
    packages: 'external', platform: 'node', format: 'esm', outfile, plugins: [plugin],
    define: { 'process.env.NEXT_PUBLIC_NOTEGEN_CUSTOM_BUILD': '"1"' } })
  const { main, custom, parseCustomManifest, newerCustomVersion } = await import(pathToFileURL(outfile).href)
  await main.getState().checkForUpdates()
  assert.equal(main.getState().hasUpdate, true)
  assert.equal(custom.getState().manifest.version, '0.39.1-custom.3')
  assert.ok(context.events.includes('native-check:darwin-aarch64'))
  await custom.getState().ignore('0.39.1-custom.3')
  assert.equal(custom.getState().hasUpdate, false)
  assert.equal(main.getState().hasUpdate, false)
  await custom.getState().check()
  assert.equal(custom.getState().hasUpdate, false)
  await custom.getState().ignore('')
  assert.equal(main.getState().hasUpdate, true)
  context.events = []
  await custom.getState().install()
  assert.deepEqual(context.events, ['download', 'flush-active', 'flush-all', 'install', 'relaunch'])
  custom.setState({ status: 'ready' }); context.events = []; context.failInstall = true
  await custom.getState().install()
  assert.equal(custom.getState().status, 'error')
  assert.ok(!context.events.includes('relaunch'))
  assert.match(custom.getState().error, /Signature/)
  assert.equal(custom.getState().errorKind, null)
  context.failInstall = false; context.os = 'android'; context.events = []
  const mobileInfo = await main.getState().checkForMobileUpdates(context.current)
  assert.equal(mobileInfo.version, '0.39.1-custom.3')
  assert.deepEqual(main.getState().mobileUpdate, mobileInfo)
  assert.equal(custom.getState().hasUpdate, true)
  await custom.getState().ignore('0.39.1-custom.3')
  assert.equal(main.getState().mobileUpdate, null)
  await custom.getState().ignore('')
  assert.equal(main.getState().mobileUpdate.version, '0.39.1-custom.3')
  assert.ok(!context.events.some(e => e.startsWith('native-check')))
  context.os = 'windows'; context.arch = 'x86_64'; context.events = []
  await custom.getState().check()
  assert.ok(context.events.includes('native-check:windows-x86_64-nsis'))
  context.status = 404
  await custom.getState().check()
  assert.equal(custom.getState().status, 'ready')
  assert.equal(custom.getState().hasUpdate, false)
  context.status = 503
  await custom.getState().check()
  assert.equal(custom.getState().status, 'error')
  assert.equal(custom.getState().update, null)
  assert.ok(!newerCustomVersion(manifest(), '0.40.0-custom.1'))
  assert.ok(!newerCustomVersion(manifest(), '0.39.1-custom.10'))
  for (const bad of [null, { ...manifest(), version: '0.39.1' }, { ...manifest(), android: { ...manifest().android, url: 'https://evil.example/app.apk' } }]) {
    assert.throws(() => parseCustomManifest(bad))
  }
  // 首次网络失败也必须显示已安装版本；恢复后清除错误分类。
  custom.setState({current: ''})
  context.status = 200; context.failFetch = true
  let releaseFetch
  context.fetchWait = new Promise(resolve => { releaseFetch = resolve })
  const requestStarted = new Promise(resolve => { context.onFetch = resolve })
  const checking = custom.getState().check()
  await requestStarted
  assert.equal(custom.getState().status, 'checking')
  assert.equal(custom.getState().current, context.current)
  releaseFetch()
  await checking
  delete context.fetchWait; delete context.onFetch
  assert.equal(custom.getState().current, context.current)
  assert.equal(custom.getState().errorKind, 'network')
  assert.equal(custom.getState().hasUpdate, false)
  context.failFetch = false

  // 系统模式忽略残留手动地址；新原生客户端自行发现系统代理。
  context.settings = { systemProxy: true, proxy: 'file:///stale-proxy', proxyCustomURL: 'http://old:7890' }
  await custom.getState().check()
  assert.equal(custom.getState().errorKind, null)
  assert.equal(context.httpRequests.at(-1).proxy, undefined)
  assert.equal(context.nativeChecks.at(-1).proxy, undefined)

  // 手动 HTTP/SOCKS 地址贯穿清单检查、原生检查及实际下载资源。
  for (const proxy of ['127.0.0.1:7890', 'https://localhost:7891', 'socks5://127.0.0.1:1080', 'socks5h://127.0.0.1:1080']) {
    context.settings = { systemProxy: false, proxy: ' ' + proxy + ' ' }
    const expected = new URL(proxy.includes('://') ? proxy : 'http://' + proxy).href
    await custom.getState().check()
    assert.equal(context.httpRequests.at(-1).proxy.all, expected)
    assert.equal(context.nativeChecks.at(-1).proxy, expected)
    await custom.getState().install()
    assert.equal(context.downloads.at(-1), expected)
    custom.setState({status: 'ready'})
  }
  context.settings = { systemProxy: false, proxy: '' }
  await custom.getState().check()
  assert.equal(context.httpRequests.at(-1).proxy, undefined)
  assert.equal(context.nativeChecks.at(-1).proxy, undefined)

  // 检查后切换代理，下载资源必须刷新，不能继续使用旧地址。
  context.settings.proxy = 'http://localhost:7892'
  await custom.getState().install()
  assert.equal(context.downloads.at(-1), 'http://localhost:7892/')
  custom.setState({status: 'ready'})
  context.settings.systemProxy = true
  await custom.getState().install()
  assert.equal(context.downloads.at(-1), undefined)
  custom.setState({status: 'ready'})

  // 代理变更后渠道也变更时拒绝下载；关闭不匹配的原生资源。
  context.settings = {systemProxy: false, proxy: 'http://localhost:7893'}
  context.candidateVersion = '0.39.1-custom.4'
  const downloadsBefore = context.downloads.length, closedBefore = context.closed
  await custom.getState().install()
  assert.equal(context.downloads.length, downloadsBefore)
  assert.equal(context.closed, closedBefore + 1)
  assert.match(custom.getState().error, /channel changed/)
  context.candidateVersion = ''
  await custom.getState().check()
  context.failDownload = true
  const installsBefore = context.events.filter(e => e === 'install').length
  await custom.getState().install()
  assert.equal(custom.getState().errorKind, 'network')
  assert.equal(context.events.filter(e => e === 'install').length, installsBefore)
  context.failDownload = false
  context.failNative = true
  await custom.getState().check()
  assert.equal(custom.getState().errorKind, 'network')
  assert.equal(custom.getState().current, context.current)
  context.failNative = false

  // 无效代理不发送请求，且不回显填写的地址；不会偷偷回退为直连。
  const requestsBefore = context.httpRequests.length
  context.settings.proxy = 'file:///private-proxy'
  await custom.getState().check()
  assert.equal(context.httpRequests.length, requestsBefore)
  assert.equal(custom.getState().errorKind, 'proxy')
  assert.ok(!custom.getState().error.includes('private-proxy'))
  context.settings.proxy = 'http://localhost:7890'
  context.os = 'android'
  const nativeBefore = context.nativeChecks.length
  await custom.getState().check()
  assert.equal(context.httpRequests.at(-1).proxy.all, 'http://localhost:7890/')
  assert.equal(context.nativeChecks.length, nativeBefore)
  assert.equal(custom.getState().errorKind, null)
  assert.equal(custom.getState().hasUpdate, true)
  const normalFile = path.join(directory, 'normal.mjs')
  await build({ entryPoints: ['src/stores/update.ts'], bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: normalFile,
    define: { 'process.env.NEXT_PUBLIC_NOTEGEN_CUSTOM_BUILD': '"0"' } })
  const normal = await import(pathToFileURL(normalFile).href)
  assert.equal(normal.ANDROID_DOWNLOAD_URL, 'https://notegen.top/download')
  assert.equal(normal.IOS_TESTFLIGHT_URL, 'https://testflight.apple.com/join/8KjFRTCq')
  console.log('Custom updates: channel isolation, native targets, ignore/restore, Android, 404/errors, offline version display, system/manual proxy routing, proxy changes, download failures, install ordering and version validation passed.')
} finally {
  delete globalThis.__customTest
  await rm(directory, { recursive: true, force: true })
}
