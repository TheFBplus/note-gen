'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CUSTOM_RELEASES_URL } from '@/lib/custom-build'

/** 定制包先手动下载更新，避免误装官方包。将来可独立接入自己的签名更新服务。 */
export function CustomBuildUpdates() {
  const t = useTranslations('customBuild')
  const [failed, setFailed] = useState(false)
  return <Card>
    <CardHeader>
      <CardTitle>{t('title')}</CardTitle>
      <CardDescription>{t('description')}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('manual')}</p>
      <Button onClick={() => { void openUrl(CUSTOM_RELEASES_URL).catch(() => setFailed(true)) }}>{t('download')}</Button>
      {failed && <p role="alert" className="break-all text-sm">{t('openFailed')} {CUSTOM_RELEASES_URL}</p>}
    </CardContent>
  </Card>
}
