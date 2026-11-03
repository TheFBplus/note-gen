'use client'

import { useMemo, type ReactNode } from 'react'
import { NextIntlClientProvider, useLocale, useMessages, useTimeZone } from 'next-intl'
import { withExtensionMessages } from './messages'

/** 跟随上游 Provider 的语言/插件刷新，不修改上游字典或语言加载流程。 */
export function ExtensionMessagesProvider({ children }: { children: ReactNode }) {
  const locale = useLocale()
  const upstream = useMessages()
  const timeZone = useTimeZone()
  const messages = useMemo(() => withExtensionMessages(upstream, locale), [upstream, locale])
  return <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={messages}>{children}</NextIntlClientProvider>
}
