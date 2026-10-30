import assert from 'node:assert/strict'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import CodeBlock from '@tiptap/extension-code-block'
import { closeHistory } from '@tiptap/pm/history'
import { HtmlEmbedNode } from '../src/extensions/html-embed/node'
import { parseFencedCodeBlockToken, renderFencedCodeBlockNode } from '../src/app/core/main/editor/markdown/code-block-markdown'

// 可选 DOM 测试依赖从仓库外提供，不修改应用依赖或锁文件。
const { JSDOM } = await import(process.env.HTML_EMBED_DOM_MODULE!)
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://notegen.test' })
for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'MutationObserver', 'DOMParser', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
}
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as unknown as number
globalThis.cancelAnimationFrame = id => clearTimeout(id)
const extensions = [
  StarterKit.configure({ codeBlock: false }),
  CodeBlock.extend({ parseMarkdown: parseFencedCodeBlockToken, renderMarkdown: renderFencedCodeBlockNode }),
  HtmlEmbedNode,
  Markdown,
]
const attrs = { file: '', code: '<script>window.pwned = true</script><input value="hello">', title: '<>&"', height: 520 }
const editor = new Editor({ extensions, content: '<p>Before</p><p>After</p>' })
editor.commands.insertContentAt(8, { type: 'htmlEmbed', attrs })
assert.equal(editor.getJSON().content?.filter(node => node.type === 'htmlEmbed').length, 1)
const html = editor.getHTML()
assert.ok(html.includes('data-notegen-html-embed="1"'))
assert.ok(!html.includes('<script>'))
const pasted = new Editor({ extensions, content: html })
assert.deepEqual({ ...pasted.getJSON().content?.find(node => node.type === 'htmlEmbed')?.attrs }, attrs)
const referenced = new Editor({ extensions, content: { type: 'doc', content: [{ type: 'htmlEmbed', attrs: { code: '', file: './embeds/demo.html', title: 'File', height: 360 } }] } })
const copiedReference = new Editor({ extensions, content: referenced.getHTML() })
assert.equal(copiedReference.getJSON().content?.find(node => node.type === 'htmlEmbed')?.attrs?.file, './embeds/demo.html')
assert.ok(!referenced.getHTML().includes('<iframe'))
referenced.destroy()
copiedReference.destroy()
const markdown = editor.getMarkdown()
const reopened = new Editor({ extensions, content: markdown, contentType: 'markdown' })
assert.deepEqual({ ...reopened.getJSON().content?.find(node => node.type === 'htmlEmbed')?.attrs }, attrs)
editor.commands.setNodeSelection(8)
editor.view.dispatch(closeHistory(editor.state.tr))
editor.commands.deleteSelection()
assert.equal(editor.getJSON().content?.filter(node => node.type === 'htmlEmbed').length, 0)
assert.equal(editor.commands.undo(), true)
assert.equal(editor.getJSON().content?.filter(node => node.type === 'htmlEmbed').length, 1)
assert.equal(editor.commands.redo(), true)
assert.equal(editor.getJSON().content?.filter(node => node.type === 'htmlEmbed').length, 0)
assert.equal(dom.window.pwned, undefined)
for (const instance of [editor, pasted, reopened]) instance.destroy()
export const closeDom = () => dom.window.close()
console.log('HTML Embed DOM: insertion, inert clipboard HTML, reopen, deletion, undo and redo passed.')
