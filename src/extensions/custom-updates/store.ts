'use client'

import { create } from 'zustand'
import { getVersion } from '@tauri-apps/api/app'
import { getAllWebviewWindows } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'
import { platform, arch } from '@tauri-apps/plugin-os'
import { fetch } from '@tauri-apps/plugin-http'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { Store } from '@tauri-apps/plugin-store'
import { relaunch } from '@tauri-apps/plugin-process'
import { resolveUpdateProxy, UpdateNetworkError, updateFailure } from './network'
import { CUSTOM_UPDATE_URL, CUSTOM_UPDATE_FALLBACK_URL, newerCustomVersion, parseCustomManifest, type CustomManifest } from './protocol'

interface State {
  current: string
  mobile: boolean
  manifest: CustomManifest | null
  update: Update | null
  status: 'idle' | 'checking' | 'ready' | 'downloading' | 'installing' | 'error'
  error: string
  errorKind: 'network' | 'proxy' | null
  ignored: string
  progress: number | null
  hasUpdate: boolean
  check: () => Promise<void>
  ignore: (version: string) => Promise<void>
  install: () => Promise<void>
}
let pending: Promise<void> | null = null
// 原生 Update 保存检查时的代理供下载使用；不把带认证信息的地址放入 React 状态或磁盘。
const updateProxies = new WeakMap<Update, string | undefined>()

async function desktopUpdate(version: string, proxy: string | undefined) {
  const os = platform()
  if (os === 'windows' && arch() !== 'x86_64' || os === 'macos' && arch() !== 'aarch64') throw new Error('Unsupported custom update architecture')
  const target = os === 'windows' ? await invoke<string>('get_desktop_update_target') : 'darwin-aarch64'
  if (target !== 'windows-x86_64-nsis' && target !== 'darwin-aarch64') throw new Error('Unsupported custom installer')
  const candidate = await check({ target, timeout: 10_000, proxy })
  if (!candidate || candidate.version !== version) {
    await candidate?.close().catch(() => {})
    throw new Error('Update channel changed; please check again')
  }
  updateProxies.set(candidate, proxy)
  return candidate
}

export const useCustomUpdates = create<State>((set, get) => ({
  current: '', mobile: false, manifest: null, update: null, status: 'idle', error: '', errorKind: null, ignored: '', progress: null, hasUpdate: false,
  check: () => {
    if (pending) return pending
    if (['downloading', 'installing'].includes(get().status)) return Promise.resolve()
    pending = (async () => {
      set({ status: 'checking', error: '', errorKind: null })
      let candidate: Update | null = null
      try {
        const current = await getVersion()
        // 本地版本不依赖网络、代理或忽略设置读取成功。
        set({ current })
        const storage = await Store.load('custom-updates.json')
        const ignored = await storage.get<string>('ignoredVersion') || ''
        const proxy = await resolveUpdateProxy()
        // 主站不可达/尚未发布时才尝试 GitHub；格式错误的清单不被备用渠道掩盖。
        let manifest: CustomManifest | null = null
        let networkFailed = false
        for (const endpoint of [CUSTOM_UPDATE_URL, CUSTOM_UPDATE_FALLBACK_URL]) {
          let response
          try {
            response = await fetch(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store', connectTimeout: 10_000,
              ...(proxy ? { proxy: { all: proxy } } : {}) })
          } catch { networkFailed = true; continue }
          if (response.status === 404) continue
          if (!response.ok) { networkFailed = true; continue }
          manifest = parseCustomManifest(await response.json())
          break
        }
        if (!manifest) {
          if (networkFailed) throw new UpdateNetworkError()
          await get().update?.close()
          set({ current, ignored, manifest: null, update: null, hasUpdate: false, status: 'ready' })
          return
        }
        const newer = newerCustomVersion(manifest, current)
        const os = platform()
        if (newer && (os === 'windows' || os === 'macos')) {
          // 原生 updater 复查固定签名渠道；代理会保留在 Update 资源中供下载使用。
          candidate = await desktopUpdate(manifest.version, proxy)
        }
        await get().update?.close()
        set({ current, ignored, mobile: os === 'android', manifest: newer ? manifest : null, update: candidate,
          hasUpdate: newer && manifest.version !== ignored && (os === 'android' || Boolean(candidate)), status: 'ready' })
      } catch (error) {
        await candidate?.close().catch(() => {})
        await get().update?.close().catch(() => {})
        set({ status: 'error', ...updateFailure(error), hasUpdate: false, manifest: null, update: null })
      } finally { pending = null }
    })()
    return pending
  },
  ignore: async (version) => {
    const storage = await Store.load('custom-updates.json')
    await storage.set('ignoredVersion', version)
    await storage.save()
    set({ ignored: version, hasUpdate: Boolean(get().manifest && get().manifest?.version !== version) })
  },
  install: async () => {
    let update = get().update
    if (!update || ['downloading', 'installing'].includes(get().status)) return
    set({ status: 'downloading', error: '', errorKind: null, progress: null })
    try {
      if ((await getAllWebviewWindows()).some(window => window.label.startsWith('editor-'))) throw new Error('Close separate editor windows before updating')
      const proxy = await resolveUpdateProxy()
      // 检查后修改代理时，重新创建原生资源并绑定已展示版本，避免仍沿用旧代理下载或静默切换版本。
      if (proxy !== updateProxies.get(update)) {
        const replacement = await desktopUpdate(update.version, proxy)
        await update.close().catch(() => {})
        update = replacement
        set({ update })
      }
      let total = 0, received = 0
      await update.download(event => {
        if (event.event === 'Started') total = event.data.contentLength || 0
        if (event.event === 'Progress') received += event.data.chunkLength
        set({ progress: total ? Math.min(100, Math.round(received / total * 100)) : null })
      })
      // 下载完成后再刷盘；此时界面会阻止在主窗口继续编辑。
      if ((await getAllWebviewWindows()).some(window => window.label.startsWith('editor-'))) throw new Error('Close separate editor windows before updating')
      const { default: articles } = await import('@/stores/article')
      const { prepareActiveEditorDeactivationDurably } = await import('@/lib/editor-deactivation')
      if (!await prepareActiveEditorDeactivationDurably(articles.getState().activeFilePath)) throw new Error('Cannot save current note; installation stopped')
      await articles.getState().flushAllPendingArticleSaves()
      set({ status: 'installing' })
      await update.install()
      await relaunch()
    } catch (error) {
      set({ status: 'error', ...updateFailure(error) })
    }
  },
}))
