'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { openUrl } from '@tauri-apps/plugin-opener'
import { platform } from '@tauri-apps/plugin-os'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { CUSTOM_RELEASES_URL, IS_CUSTOM_BUILD } from '@/lib/custom-build'
import useUpdateStore from '@/stores/update'
import { useCustomUpdates } from './store'

export function CustomBuildUpdates() {
  const t = useTranslations('customBuild')
  const state = useCustomUpdates()
  const [openingError, setOpeningError] = useState('')
  useEffect(() => { void state.check() }, [state.check])
  useEffect(() => { useUpdateStore.getState().setHasUpdate(state.hasUpdate) }, [state.hasUpdate])
  const busy = ['checking', 'downloading', 'installing'].includes(state.status)
  const android = state.manifest?.android.url
  async function open(url: string) {
    try { await openUrl(url); setOpeningError('') }
    catch { setOpeningError(t('openFailed') + ' ' + url) }
  }
  return <Card>
    <CardHeader>
      <CardTitle>{t('title')}</CardTitle>
      <CardDescription>{t('description')}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm">{t('current', { version: state.current || '—' })}</p>
      {state.manifest && <>
        <p className="text-sm">{t('available', { version: state.manifest.version })}</p>
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{state.manifest.notes}</p>
        {state.ignored === state.manifest.version && <p className="text-sm">{t('ignored')}</p>}
      </>}
      {state.status === 'ready' && !state.manifest && <p className="text-sm">{t('upToDate')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => { void state.check() }}>{t(busy ? 'checking' : 'check')}</Button>
        {state.hasUpdate && <Button disabled={busy} onClick={() => {
          if (platform() === 'android' && android) void open(android)
          else void state.install()
        }}>{t(platform() === 'android' ? 'downloadApk' : 'install')}</Button>}
        {state.manifest && <Button variant="outline" disabled={busy} onClick={() => {
          void state.ignore(state.ignored === state.manifest?.version ? '' : state.manifest!.version).catch(error => setOpeningError(String(error)))
        }}>{t(state.ignored === state.manifest.version ? 'restore' : 'ignore')}</Button>}
        <Button variant="outline" onClick={() => { void open(CUSTOM_RELEASES_URL) }}>{t('download')}</Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('manual')}</p>
      {(state.error || openingError) && <p role="alert" className="break-all text-sm text-destructive">{state.error || openingError}</p>}
    </CardContent>
  </Card>
}

/** 全局对话框在下载和刷盘安装期间阻止主窗口继续编辑。 */
export function CustomUpdateGuard() {
  const t = useTranslations('customBuild')
  const { status, progress } = useCustomUpdates()
  if (!IS_CUSTOM_BUILD || !['downloading', 'installing'].includes(status)) return null
  return <Dialog open>
    <DialogContent showCloseButton={false} onEscapeKeyDown={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}>
      <DialogTitle>{t(status === 'installing' ? 'installing' : 'downloading')}</DialogTitle>
      <DialogDescription>{t('keepOpen')}</DialogDescription>
      {progress !== null && <p role="status">{progress}%</p>}
    </DialogContent>
  </Dialog>
}
