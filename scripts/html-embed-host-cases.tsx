import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider, useTranslations } from 'next-intl'
import { Editor } from '@tiptap/core'
import { ExtensionMessagesProvider } from '../src/extensions/locales/provider'
import { withExtensionMessages } from '../src/extensions/locales/messages'
import { useHtmlEmbedSlashItems, useHtmlEmbedToolbarItems } from '../src/extensions/html-embed/menus'
import { handleHtmlEmbedToolbarAction } from '../src/extensions/html-embed/commands'
import { combinedMarkdownExtensions } from './html-embed-upstream-schema'
import { MobileWritingToolbar } from '../src/app/core/main/editor/markdown/mobile-writing-toolbar'
import en from '../messages/en.json'
import zh from '../messages/zh.json'

// 不修改输入；上游新字段与语言插件的部分扩展翻译都应保留。
const supplied = { editor: { headingFolding: { expand: 'upstream' }, htmlEmbed: { title: 'plugin title' } }, customBuild: { title: 'plugin updater' } }
const snapshot = JSON.stringify(supplied)
const merged = withExtensionMessages(supplied, 'ja')
assert.equal(JSON.stringify(supplied), snapshot)
assert.equal((merged.customBuild as Record<string, string>).title, 'plugin updater')
assert.equal((merged.customBuild as Record<string, string>).check, 'Check for updates')
assert.equal(((merged.editor as Record<string, Record<string, string>>).htmlEmbed).title, 'plugin title')
assert.equal(((merged.editor as Record<string, Record<string, string>>).headingFolding).expand, 'upstream')
assert.equal(Object.hasOwn(en, 'customBuild'), false)
assert.equal(Object.hasOwn(en.editor, 'htmlEmbed'), false)

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const target = document.createElement('div')
document.body.append(target)
const root = createRoot(target)
let slash: ReturnType<typeof useHtmlEmbedSlashItems> = []
let toolbar: ReturnType<typeof useHtmlEmbedToolbarItems> = []
function Harness({ menu }: { menu: string }) {
  slash = useHtmlEmbedSlashItems()
  toolbar = useHtmlEmbedToolbarItems(menu)
  const t = useTranslations('customBuild')
  return <span>{t('check')}</span>
}
try {
  for (const [locale, messages, expected, title] of [
    ['en', en, 'Check for updates', 'HTML Embed'], ['zh', zh, '检查更新', 'HTML 嵌入'],
  ] as const) {
    await act(async () => root.render(<NextIntlClientProvider locale={locale} timeZone="UTC" messages={messages}>
      <ExtensionMessagesProvider><Harness menu="block" /></ExtensionMessagesProvider>
    </NextIntlClientProvider>))
    assert.equal(target.textContent, expected)
    assert.equal(slash.length, 1)
    assert.equal(toolbar.length, 1)
    assert.equal(slash[0].title, title)
    assert.equal(toolbar[0].label, title)
  }
  const editor = new Editor({ extensions: combinedMarkdownExtensions(), content: '<p>/html</p>' })
  slash[0].command({ editor, range: { from: 1, to: 6 } })
  assert.ok(!editor.getText().includes('/html'))
  assert.equal(editor.getJSON().content?.filter(node => node.type === 'htmlEmbed').length, 1)
  editor.commands.setContent('<p>Body</p>')
  let runs = 0
  const run = (command: () => boolean) => { runs++; command() }
  assert.equal(handleHtmlEmbedToolbarAction('insert-html-embed', editor, run), true)
  assert.equal(runs, 1)
  assert.equal(editor.getJSON().content?.filter(node => node.type === 'htmlEmbed').length, 1)
  assert.equal(handleHtmlEmbedToolbarAction('insert-code-block', editor, run), false)
  assert.equal(runs, 1)
  editor.destroy()
  await act(async () => root.render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
    <ExtensionMessagesProvider><Harness menu="root" /></ExtensionMessagesProvider>
  </NextIntlClientProvider>))
  assert.equal(toolbar.length, 0)
  let action = ''
  await act(async () => root.render(<NextIntlClientProvider locale="zh" timeZone="UTC" messages={zh}>
    <ExtensionMessagesProvider><MobileWritingToolbar onAction={value => { action = value }} /></ExtensionMessagesProvider>
  </NextIntlClientProvider>))
  assert.equal(target.querySelector('[aria-label="HTML 嵌入"]'), null)
  await act(async () => (target.querySelector('[aria-label="块级"]') as HTMLButtonElement).click())
  await act(async () => (target.querySelector('[aria-label="HTML 嵌入"]') as HTMLButtonElement).click())
  assert.equal(action, 'insert-html-embed')
  assert.equal(target.querySelector('[aria-label="HTML 嵌入"]'), null)
} finally { await act(async () => root.unmount()); target.remove() }
console.log('HTML Embed host: provider language switching/overrides, unchanged upstream dictionaries, shared slash/mobile commands and menu scoping passed.')
