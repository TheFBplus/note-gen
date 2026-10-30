import assert from 'node:assert/strict'
import { MarkdownManager, Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import CodeBlock from '@tiptap/extension-code-block'
import type { JSONContent } from '@tiptap/core'
import { HtmlEmbedNode } from '../src/extensions/html-embed/node'
import { HTML_EMBED_EXAMPLE, renderHtmlEmbedMarkdown } from '../src/extensions/html-embed/markdown'
import { buildEmbedDocument } from '../src/extensions/html-embed/sandbox'
import { createMarkdownLexer } from '../src/app/core/main/editor/markdown/markdown-tokenizers'
import { parseFencedCodeBlockToken, renderFencedCodeBlockNode } from '../src/app/core/main/editor/markdown/code-block-markdown'

const manager = new MarkdownManager({ extensions: [
  StarterKit.configure({ codeBlock: false }),
  CodeBlock.extend({ parseMarkdown: parseFencedCodeBlockToken, renderMarkdown: renderFencedCodeBlockNode }),
  HtmlEmbedNode,
  Markdown,
] })
const find = (node: JSONContent, type: string): JSONContent[] => [
  ...(node.type === type ? [node] : []), ...(node.content ?? []).flatMap(child => find(child, type)),
]
const codes = [
  '', HTML_EMBED_EXAMPLE, '<p>你好 🌍</p>', '<script>const x = "```";</script>',
  '<pre>``````\n~~~\n</pre>', '<p>trailing newline</p>\n', '\n\n',
  '<!-- {"version":99} -->\n<input value="&quot;">',
]
for (const code of codes) {
  const attrs = { code, file: '', height: 480, title: 'Example " <>& 中文' }
  const source = `Before.\n\n${renderHtmlEmbedMarkdown({ type: 'htmlEmbed', attrs })}\n\nAfter.`
  const parsed = manager.parse(source)
  assert.deepEqual(find(parsed, 'htmlEmbed')[0]?.attrs, attrs)
  const serialized = manager.serialize(parsed)
  assert.deepEqual(find(manager.parse(serialized), 'htmlEmbed')[0]?.attrs, attrs)
  assert.equal(manager.serialize(manager.parse(serialized)), serialized)
  const tokens = createMarkdownLexer().lexer(source)
  assert.equal(tokens.find(token => token.type === 'html_embed')?.content, code)
}
for (const source of [
  '~~~html-embed\n<button>Hi</button>\n~~~',
  '````html-embed\r\n<p>test</p>\r\n````',
  '- item\n\n  ```html-embed\n  <p>nested</p>\n  ```',
  '> ```html-embed\n> <p>quote</p>\n> ```',
  '```html-embed\n<p>unclosed</p>',
  '```html-embed',
]) {
  assert.equal(find(manager.parse(source), 'htmlEmbed').length, 1, source)
}
for (const source of [
  '```html\n<button>ordinary code</button>\n```',
  '```html-embed {"version":2}\n<p>future version</p>\n```',
  '```html-embed invalid\n<p>invalid metadata</p>\n```',
  '```html-embed {"unknown":true}\n<p>unknown metadata</p>\n```',
  '```html-embed {"height":"400"}\n<p>invalid height</p>\n```',
  '````markdown\n```html-embed\n<p>nested example</p>\n```\n````',
]) {
  const parsed = manager.parse(source)
  assert.equal(find(parsed, 'htmlEmbed').length, 0, source)
  assert.equal(find(parsed, 'codeBlock').length, 1, source)
  const once = manager.serialize(parsed)
  assert.equal(manager.serialize(manager.parse(once)), once)
}
const document = buildEmbedDocument('<script>parent.test = 1</script>', 'test-token')
const titled = { file: '', code: '<p>~~~</p>', title: 'A ``` title', height: 360 }
assert.deepEqual(find(manager.parse(renderHtmlEmbedMarkdown({ type: 'htmlEmbed', attrs: titled })), 'htmlEmbed')[0]?.attrs, titled)
assert.ok(document.indexOf('Content-Security-Policy') < document.indexOf('parent.test'))
assert.ok(document.includes("connect-src 'none'"))
assert.ok(!document.includes('allow-same-origin'))
console.log('HTML Embed: round-trip, worker lexer, nested fences, metadata fallback and sandbox document checks passed.')
