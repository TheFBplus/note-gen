import assert from 'node:assert/strict'
import { MarkdownManager, Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import CodeBlock from '@tiptap/extension-code-block'
import { HtmlEmbedNode } from '../src/extensions/html-embed/node'
import { renderHtmlEmbedMarkdown } from '../src/extensions/html-embed/markdown'
import { EmbedFileError, resolveEmbedFilePath, selectedEmbedReference } from '../src/extensions/html-embed/file-path'
import { MAX_EMBED_FILE_BYTES, readHtmlEmbedFile } from '../src/extensions/html-embed/file-source'
import { createMarkdownLexer } from '../src/app/core/main/editor/markdown/markdown-tokenizers'
import { remarkHtmlEmbedFiles } from '../src/extensions/html-embed/remark'
import { parseFencedCodeBlockToken, renderFencedCodeBlockNode } from '../src/app/core/main/editor/markdown/code-block-markdown'

const manager = new MarkdownManager({ extensions: [
  StarterKit.configure({ codeBlock: false }),
  CodeBlock.extend({ parseMarkdown: parseFencedCodeBlockToken, renderMarkdown: renderFencedCodeBlockNode }),
  HtmlEmbedNode, Markdown,
] })
const attrs = { code: '', file: '../embeds/图表.html', height: 480, title: 'File " title' }
const source = renderHtmlEmbedMarkdown({ type: 'htmlEmbed', attrs })
const parsed = manager.parse(source)
assert.deepEqual(parsed.content?.[0]?.attrs, attrs)
assert.deepEqual(manager.parse(manager.serialize(parsed)), parsed)
assert.equal(manager.serialize(manager.parse(manager.serialize(parsed))), manager.serialize(parsed))
assert.deepEqual(createMarkdownLexer().lexer(source).find(token => token.type === 'html_embed')?.attrs, attrs)
for (const metadata of [
  { version: 2, file: '/tmp/x.html' }, { version: 2, file: 'https://example.com/x.html' },
  { version: 2, file: './x.txt' }, { version: 2, file: './x.html', unexpected: true },
  { version: 1, file: './x.html' }, { version: 3, file: './x.html' },
]) {
  const invalid = '```html-embed ' + JSON.stringify(metadata) + '\n\n```'
  assert.equal(manager.parse(invalid).content?.[0]?.type, 'codeBlock')
}
assert.equal(manager.parse('```html-embed {"version":2,"file":"./x.html"}\n<p>Do not discard this</p>\n```').content?.[0]?.type, 'codeBlock')
assert.equal(resolveEmbedFilePath('notes/test.md', '../embeds/demo.html', '/workspace'), 'embeds/demo.html')
assert.equal(resolveEmbedFilePath('/workspace/notes/test.md', './demo.html', '/workspace'), 'notes/demo.html')
assert.equal(resolveEmbedFilePath('C:\\Workspace\\notes\\test.md', '../embeds/demo.htm', 'C:\\Workspace'), 'embeds/demo.htm')
assert.equal(selectedEmbedReference('notes/test.md', '/workspace/embeds/demo.html', '/workspace'), '../embeds/demo.html')
assert.equal(selectedEmbedReference('test.md', '/workspace/embeds/demo.html', '/workspace'), './embeds/demo.html')
for (const file of ['../../escape.html', 'file:///x.html', '/tmp/x.html', 'C:\\x.html', '//server/x.html', './x.html#fragment', './x.html?query=1', './x.html\0', './x.txt', '.././../x.html']) {
  assert.throws(() => resolveEmbedFilePath('notes/test.md', file, '/workspace'), EmbedFileError)
}
assert.throws(() => selectedEmbedReference('test.md', '/workspace-other/demo.html', '/workspace'), EmbedFileError)
assert.throws(() => resolveEmbedFilePath('/elsewhere/test.md', './x.html', '/workspace'), EmbedFileError)
assert.throws(() => resolveEmbedFilePath('', './x.html', '/workspace'), (error: EmbedFileError) => error.code === 'missingNote')
const context = { notePath: 'notes/test.md', workspaceRoot: '/workspace' }
const html = '<button>你好 🌍</button>'
assert.equal(await readHtmlEmbedFile(context, '../embeds/demo.html', async (root, path, length) => {
  assert.equal(root, '/workspace'); assert.equal(path, 'embeds/demo.html'); assert.equal(length, MAX_EMBED_FILE_BYTES + 1)
  return Buffer.from(html).toString('base64')
}), html)
for (const [bytes, expected] of [
  [Buffer.alloc(MAX_EMBED_FILE_BYTES + 1, 65), 'fileTooLarge'],
  [Buffer.alloc(262145, 65), 'fileTooLarge'],
  [Buffer.from([0xff, 0xfe]), 'invalidEncoding'],
  [Buffer.from('abc\0def'), 'invalidEncoding'],
] as const) {
  await assert.rejects(readHtmlEmbedFile(context, './demo.html', async () => bytes.toString('base64')), (error: EmbedFileError) => error.code === expected)
}
await assert.rejects(readHtmlEmbedFile(context, './missing.html', async () => { throw { code: 'NotFound' } }), (error: EmbedFileError) => error.code === 'fileReadFailed')
let touched = false
await assert.rejects(readHtmlEmbedFile(context, '../../outside.html', async () => { touched = true; return '' }))
assert.equal(touched, false)
const exported = { type: 'root', children: [{ type: 'code', lang: 'html-embed', meta: JSON.stringify({ version: 2, file: './demo.html' }), value: '' }] }
remarkHtmlEmbedFiles()(exported)
assert.equal(exported.children[0].lang, 'markdown')
assert.ok(exported.children[0].value.includes('./demo.html'))
const ordinary = { type: 'code', lang: 'html', meta: '', value: '<button>Plain code</button>' }
remarkHtmlEmbedFiles()(ordinary)
assert.equal(ordinary.lang, 'html')
console.log('HTML Embed file: v2/clipboard protocol, path boundaries, UTF-8, size limits, missing-file handling and bounded reader passed.')
