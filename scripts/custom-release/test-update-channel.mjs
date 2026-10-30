// Execute from the candidate repository root, including when this script lives in automation/.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { build } = createRequire(path.resolve('package.json'))('esbuild')
const cache = path.resolve('node_modules/.cache')
await mkdir(cache, { recursive: true })
const directory = await mkdtemp(path.join(cache, 'custom-update-'))
try {
  for (const enabled of ['1', '0']) {
    const outfile = path.join(directory, `channel-${enabled}.mjs`)
    await build({ entryPoints: ['src/stores/update.ts'], bundle: true, packages: 'external',
      platform: 'node', format: 'esm', outfile,
      define: { 'process.env.NEXT_PUBLIC_NOTEGEN_CUSTOM_BUILD': JSON.stringify(enabled) } })
    const channel = await import(pathToFileURL(outfile).href)
    if (enabled === '1') {
      const store = channel.default
      store.setState({ hasUpdate: true })
      // Node 没有 Tauri IPC；如分支错误地调用任何原生检查，此测试会失败。
      await store.getState().checkForUpdates({ throwOnError: true })
      assert.equal(store.getState().hasUpdate, false)
      assert.equal(await store.getState().checkForMobileUpdates('0.0.1'), null)
      assert.equal(store.getState().mobileUpdateStatus, 'ready')
      assert.equal(channel.ANDROID_DOWNLOAD_URL, 'https://github.com/TheFBplus/note-gen/releases')
    } else {
      assert.equal(channel.ANDROID_DOWNLOAD_URL, 'https://notegen.top/download')
      assert.equal(channel.IOS_TESTFLIGHT_URL, 'https://testflight.apple.com/join/8KjFRTCq')
    }
  }
  console.log('Custom update channel: desktop/mobile skip official checks; normal builds retain original URLs.')
} finally {
  await rm(directory, { recursive: true, force: true })
}
