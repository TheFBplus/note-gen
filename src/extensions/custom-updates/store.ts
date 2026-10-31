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
import { CUSTOM_UPDATE_URL, newerCustomVersion, parseCustomManifest, type CustomManifest } from './protocol'

interface State {
  current: string
  manifest: CustomManifest | null
  update: Update | null
  status: 'idle' | 'checking' | 'ready' | 'downloading' | 'installing' | 'error'
  error: string
  ignored: string
  progress: number | null
  hasUpdate: boolean
  check: () => Promise<void>
  ignore: (version: string) => Promise<void>
  install: () => Promise<void>
}
let pending: Promise<void> | null = null

export const useCustomUpdates = create<State>((set, get) => ({
  current: '', manifest: null, update: null, status: 'idle', error: '', ignored: '', progress: null, hasUpdate: false,
  check: () => {
    if (pending) return pending
    if (['downloading', 'installing'].includes(get().status)) return Promise.resolve()
    pending = (async () => {
      set({ status: 'checking', error: '' })
      let candidate: Update | null = null
      try {
        const current = await getVersion()
        const storage = await Store.load('custom-updates.json')
        const ignored = await storage.get<string>('ignoredVersion') || ''
        const response = await fetch(CUSTOM_UPDATE_URL, { headers: { Accept: 'application/json' }, cache: 'no-store', connectTimeout: 10_000 })
        // 尚未发布第一个支持更新的版本时，渠道文件不存在属于正常情况。
        if (response.status === 404) {
          await get().update?.close()
          set({ current, ignored, manifest: null, update: null, hasUpdate: false, status: 'ready' })
          return
        }
        if (!response.ok) throw new Error(`Custom update request failed: ${response.status}`)
        const manifest = parseCustomManifest(await response.json())
        const newer = newerCustomVersion(manifest, current)
        const os = platform()
        if (newer && (os === 'windows' || os === 'macos')) {
          if (os === 'windows' && arch() !== 'x86_64' || os === 'macos' && arch() !== 'aarch64') throw new Error('Unsupported custom update architecture')
          const target = os === 'windows' ? await invoke<string>('get_desktop_update_target') : 'darwin-aarch64'
          if (target !== 'windows-x86_64-nsis' && target !== 'darwin-aarch64') throw new Error('Unsupported custom installer')
          // 原生 updater 再次读取固定渠道，并在安装前验证编译进应用的公钥。
          candidate = await check({ target, timeout: 10_000 })
          if (!candidate || candidate.version !== manifest.version) throw new Error('Update channel changed; please check again')
        }
        await get().update?.close()
        set({ current, ignored, manifest: newer ? manifest : null, update: candidate,
          hasUpdate: newer && manifest.version !== ignored && (os === 'android' || Boolean(candidate)), status: 'ready' })
      } catch (error) {
        await candidate?.close().catch(() => {})
        await get().update?.close().catch(() => {})
        set({ status: 'error', error: error instanceof Error ? error.message : String(error), hasUpdate: false, manifest: null, update: null })
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
    const update = get().update
    if (!update || ['downloading', 'installing'].includes(get().status)) return
    set({ status: 'downloading', error: '', progress: null })
    try {
      if ((await getAllWebviewWindows()).some(window => window.label.startsWith('editor-'))) throw new Error('Close separate editor windows before updating')
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
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  },
}))
