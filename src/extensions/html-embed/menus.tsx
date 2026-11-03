'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Code, Code2 } from 'lucide-react'
import type { SlashCommandItem } from '@/app/core/main/editor/markdown/slash-command/suggestion'
import { insertHtmlEmbed, type HtmlEmbedToolbarAction } from './commands'

export function useHtmlEmbedSlashItems(): SlashCommandItem[] {
  const t = useTranslations('editor.slashCommand')
  return useMemo(() => [{
    id: 'notegen-html-embed', title: t('items.htmlEmbed'), description: t('items.htmlEmbedDesc'),
    icon: <Code className="w-4 h-4" />, group: t('groups.embed'), searchTerms: ['html', 'embed', 'iframe', '嵌入'],
    command: ({ editor, range }) => { insertHtmlEmbed(editor, range) },
  }], [t])
}

export function useHtmlEmbedToolbarItems(menu: string) {
  const t = useTranslations('editor.htmlEmbed')
  return useMemo(() => menu === 'block' ? [{
    kind: 'action' as const, action: 'insert-html-embed' as HtmlEmbedToolbarAction, label: t('title'), icon: Code2,
  }] : [], [menu, t])
}
