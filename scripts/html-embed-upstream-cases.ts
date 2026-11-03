import assert from 'node:assert/strict'
import type { JSONContent } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { combinedMarkdownExtensions } from './html-embed-upstream-schema'
import { buildAgentMarkdownEdit } from '../src/app/core/main/editor/markdown/agent-markdown-edit'
import { createMarkdownLexer, MARKDOWN_TOKENIZER_NAMES } from '../src/app/core/main/editor/markdown/markdown-tokenizers'
import { MARKDOWN_LEXER_VERSION, type MarkdownLexerResponse } from '../src/app/core/main/editor/markdown/markdown-lexer-protocol'
import { parsePreparedMarkdown } from '../src/app/core/main/editor/markdown/schema-markdown'
import { renderHtmlEmbedMarkdown } from '../src/extensions/html-embed/markdown'
import { withExtensionMessages } from '../src/extensions/locales/messages'
import { loadMessagesWithFallback, registerPluginLanguages, unregisterPluginLanguages } from '../src/i18n/config'

const find = (node: JSONContent, type: string): JSONContent[] => [
  ...(node.type === type ? [node] : []), ...(node.content ?? []).flatMap(child => find(child, type)),
]
const fingerprint = 'a'.repeat(64)
const header = '---\nnotegen-wiki-origin: fixture\n---'
const start = `<!-- notegen-wiki:${fingerprint}:summary:start -->`
const end = `<!-- notegen-wiki:${fingerprint}:summary:end -->`
const inline = { file: '', code: `<button>Click</button>\n${start}\n<script>const fence = "\\x60\\x60\\x60"</script>`, height: 360, title: 'Inline' }
const file = { file: './embeds/demo.html', code: '', height: 480, title: 'File' }
const source = [header, start, 'Before paragraph.', '1. First\n   1. Nested\n2. Second',
  renderHtmlEmbedMarkdown({ type: 'htmlEmbed', attrs: inline }), '- [x] Done',
  renderHtmlEmbedMarkdown({ type: 'htmlEmbed', attrs: file }), 'After paragraph.', end].join('\n\n')
const editor = new Editor({ extensions: combinedMarkdownExtensions(), content: source, contentType: 'markdown' })
const initial = editor.getJSON()
assert.deepEqual(find(initial, 'htmlEmbed').map(n => ({ ...n.attrs })), [inline, file])
assert.deepEqual(find(initial, 'wikiMetadata').map(n => n.attrs?.raw), [header, start, end])
assert.equal(find(initial, 'orderedList').length, 2)
assert.equal(find(initial, 'taskItem').length, 1)
const serialized = editor.getMarkdown()
const reopened = new Editor({ extensions: combinedMarkdownExtensions(), content: serialized, contentType: 'markdown' })
assert.deepEqual(find(reopened.getJSON(), 'htmlEmbed'), find(initial, 'htmlEmbed'))
assert.deepEqual(find(reopened.getJSON(), 'wikiMetadata'), find(initial, 'wikiMetadata'))
assert.equal(reopened.getMarkdown(), serialized)

// 新的有序列表解析器内也要保留嵌入块，不能只覆盖段落之间的情况。
for (const attrs of [inline, file]) {
  const fenced = renderHtmlEmbedMarkdown({ type: 'htmlEmbed', attrs }).split('\n').map(line => `   ${line}`).join('\n')
  const nestedSource = `1. Container\n\n${fenced}\n\n2. End`
  const nested = new Editor({ extensions: combinedMarkdownExtensions(), content: nestedSource, contentType: 'markdown' })
  assert.deepEqual(find(nested.getJSON(), 'htmlEmbed').map(node => ({ ...node.attrs })), [attrs])
  const saved = nested.getMarkdown()
  nested.commands.setContent(saved, { contentType: 'markdown' })
  assert.deepEqual(find(nested.getJSON(), 'htmlEmbed').map(node => ({ ...node.attrs })), [attrs])
  assert.deepEqual(parsePreparedMarkdown(nested, {
    source: nestedSource, tokens: createMarkdownLexer().lexer(nestedSource), tokenizerNames: MARKDOWN_TOKENIZER_NAMES, durationMs: 0, elapsedMs: 0,
  }), nested.markdown!.parse(nestedSource))
  nested.destroy()
}

// 执行真正的 worker 入口，比较主线程结果，并确认旧协议请求被拒绝。
const messages: MarkdownLexerResponse[] = []
const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'self')
const scope = { onmessage: null as ((event: { data: unknown }) => void) | null, postMessage: (value: MarkdownLexerResponse) => messages.push(value) }
Object.defineProperty(globalThis, 'self', { configurable: true, value: scope })
try {
  await import(process.env.HTML_EMBED_WORKER_FIXTURE!)
  assert.deepEqual(messages[0], { type: 'ready', version: MARKDOWN_LEXER_VERSION })
  for (const version of [3, 4]) {
    scope.onmessage!({ data: { type: 'tokenize', version, requestId: version, source } })
    assert.equal(messages.at(-1)?.type, 'error')
  }
  scope.onmessage!({ data: { type: 'tokenize', version: MARKDOWN_LEXER_VERSION, requestId: 5, source } })
  const result = messages.at(-1)!
  assert.equal(result.type, 'tokens')
  if (result.type !== 'tokens') throw new Error('Expected worker tokens')
  assert.deepEqual(result.tokens, createMarkdownLexer().lexer(source))
  assert.deepEqual(result.tokenizerNames, MARKDOWN_TOKENIZER_NAMES)
  const prepared = { source, tokens: result.tokens, tokenizerNames: result.tokenizerNames, durationMs: 0, elapsedMs: 0 }
  assert.deepEqual(parsePreparedMarkdown(editor, prepared), editor.markdown!.parse(source))
  assert.equal(parsePreparedMarkdown(editor, { ...prepared, tokenizerNames: result.tokenizerNames.filter(n => n !== 'wikiMetadata') }), null)
} finally {
  if (descriptor) Object.defineProperty(globalThis, 'self', descriptor)
  else Reflect.deleteProperty(globalThis, 'self')
}

// AI 修改前后正文，不应重写 HTML 源码/引用或 Wiki 身份。
for (const [before, after] of [['Before paragraph.', 'Before updated.'], ['After paragraph.', 'After updated.']]) {
  const baseline = editor.getMarkdown()
  const next = buildAgentMarkdownEdit(editor, baseline, baseline.replace(before, after))
  assert.deepEqual(find(next.toJSON(), 'htmlEmbed'), find(initial, 'htmlEmbed'))
  assert.deepEqual(find(next.toJSON(), 'wikiMetadata'), find(initial, 'wikiMetadata'))
  editor.commands.setContent(next.toJSON())
}
// 切换文档允许显式替换 Wiki 元数据，不应将前一笔记的标记重新插回。
editor.commands.setContent('Ordinary next note.', { contentType: 'markdown' })
assert.equal(find(editor.getJSON(), 'wikiMetadata').length, 0)
assert.equal(find(editor.getJSON(), 'htmlEmbed').length, 0)
editor.destroy()
reopened.destroy()

// 非中英文语言插件缺少自定义 key 时，使用上游既有英文回退。
registerPluginLanguages('fixture-language', [{ locale: 'ja', name: '日本語', messages: { customBuild: { title: 'テスト' } } }])
try {
  const japanese = withExtensionMessages(await loadMessagesWithFallback('ja'), 'ja')
  const english = withExtensionMessages(await loadMessagesWithFallback('en'), 'en')
  assert.equal(typeof (english.customBuild as Record<string, string>).check, 'string')
  assert.ok((english.editor as Record<string, unknown>).htmlEmbed)
  assert.equal((japanese.customBuild as Record<string, string>).title, 'テスト')
  assert.equal((japanese.customBuild as Record<string, string>).check, (english.customBuild as Record<string, string>).check)
  assert.deepEqual((japanese.editor as Record<string, unknown>).htmlEmbed, (english.editor as Record<string, unknown>).htmlEmbed)
} finally { unregisterPluginLanguages('fixture-language') }
console.log('HTML Embed upstream: Wiki/list round-trip, real worker parity/cache rejection, AI edits, document switching and language-plugin fallback passed.')
