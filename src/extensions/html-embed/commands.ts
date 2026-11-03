import type { Editor, Range } from '@tiptap/core'
import { DEFAULT_EMBED_HEIGHT } from './markdown'

export type HtmlEmbedToolbarAction = 'insert-html-embed'
export const EMPTY_HTML_EMBED = { type: 'htmlEmbed', attrs: { code: '', file: '', title: '', height: DEFAULT_EMBED_HEIGHT } }

/** 两端共用插入命令；宿主保留选区/撤销事务的调度职责。 */
export function insertHtmlEmbed(editor: Editor, range?: Range) {
  const chain = editor.chain().focus()
  return (range ? chain.deleteRange(range) : chain).insertContent(EMPTY_HTML_EMBED).run()
}

export function handleHtmlEmbedToolbarAction(action: string, editor: Editor, run: (command: () => boolean) => void) {
  if (action !== 'insert-html-embed') return false
  run(() => insertHtmlEmbed(editor))
  return true
}
