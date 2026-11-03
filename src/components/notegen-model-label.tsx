'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { NOTEGEN_FREE_MODEL, NOTEGEN_LIMITED_MODEL } from '@/lib/ai/sponsored-model-limits'

export function noteGenModelDisplayName(model: string, builtin: boolean): string {
  if (builtin && (model === NOTEGEN_LIMITED_MODEL || model === NOTEGEN_FREE_MODEL)) return 'NoteGen AI'
  return model
}

export function NoteGenModelLabel({ model, builtin = false, showFree = false }: { model: string; builtin?: boolean; showFree?: boolean }) {
  const t = useTranslations('common')
  const isNoteGenChat = builtin && (model === NOTEGEN_LIMITED_MODEL || model === NOTEGEN_FREE_MODEL)

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="truncate">{noteGenModelDisplayName(model, builtin)}</span>
      {showFree && isNoteGenChat && <Badge variant="secondary">{t('noteGenFree')}</Badge>}
    </span>
  )
}
