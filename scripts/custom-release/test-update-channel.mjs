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
  status: 200, remote: manifest(), ignored: '', events: [], windows: [], failInstall: false }
context.candidate = () => ({ version: context.remote.version, close: async () => {},
  download: async (progress) => { context.events.push('download'); progress({ event: 'Started', data: { contentLength: 10 } }); progress({ event: 'Progress', data: { chunkLength: 10 } }) },
  install: async () => { context.events.push('install'); if (context.failInstall) throw Error('Signature verification failed') } })
const mocks = {
  '@tauri-apps/api/app': 'export const getVersion = async () => c.current',
  '@tauri-apps/api/core': 'export const invoke = async () => { c.events.push("target"); return "windows-x86_64-nsis" }',
  '@tauri-apps/api/webviewWindow': 'export const getAllWebviewWindows = async () => c.windows',
  '@tauri-apps/plugin-os': 'export const platform = () => c.os; export const arch = () => c.arch',
  '@tauri-apps/plugin-http': 'export const fetch = async url => { if (!url.includes("codex/custom-update-channel/latest.json")) throw Error("Official endpoint called"); c.events.push("fetch"); return {status:c.status,ok:c.status===200,json:async()=>structuredClone(c.remote)} }',
  '@tauri-apps/plugin-updater': 'export const check = async options => { c.events.push("native-check:"+options.target); return c.candidate() }',
  '@tauri-apps/plugin-store': 'export const Store = {load:async()=>({get:async()=>c.ignored,set:async(_,v)=>{c.ignored=v},save:async()=>{}})}',
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
  await custom.getState().check()
  assert.equal(custom.getState().hasUpdate, false)
  await custom.getState().ignore('')
  context.events = []
  await custom.getState().install()
  assert.deepEqual(context.events, ['download', 'flush-active', 'flush-all', 'install', 'relaunch'])
  custom.setState({ status: 'ready' }); context.events = []; context.failInstall = true
  await custom.getState().install()
  assert.equal(custom.getState().status, 'error')
  assert.ok(!context.events.includes('relaunch'))
  assert.match(custom.getState().error, /Signature/)
  context.failInstall = false; context.os = 'android'; context.events = []
  await main.getState().checkForMobileUpdates(context.current)
  assert.equal(custom.getState().hasUpdate, true)
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
  const normalFile = path.join(directory, 'normal.mjs')
  await build({ entryPoints: ['src/stores/update.ts'], bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: normalFile,
    define: { 'process.env.NEXT_PUBLIC_NOTEGEN_CUSTOM_BUILD': '"0"' } })
  const normal = await import(pathToFileURL(normalFile).href)
  assert.equal(normal.ANDROID_DOWNLOAD_URL, 'https://notegen.top/download')
  assert.equal(normal.IOS_TESTFLIGHT_URL, 'https://testflight.apple.com/join/8KjFRTCq')
  console.log('Custom updates: channel isolation, native targets, ignore/restore, Android, 404/errors, install ordering and version validation passed.')
} finally {
  delete globalThis.__customTest
  await rm(directory, { recursive: true, force: true })
}
