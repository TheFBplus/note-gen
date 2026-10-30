import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { HtmlEmbed } from '../src/extensions/html-embed/extension'
import { EmbedFileError } from '../src/extensions/html-embed/file-path'
import messages from '../messages/en.json'

// 由 DOM fixture 先建立 jsdom；这里验证真实 React NodeView，而非模拟其 effect。
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
let editor: Editor | null = null
let notePath = 'notes/test.md'
const subscriptions = new Set<() => void>()
const reads: string[] = []
let finishSlow: ((html: string) => void) | null = null
const extension = HtmlEmbed.configure({
  getDocumentPath: () => notePath,
  subscribeDocumentChange: listener => { subscriptions.add(listener); return () => { subscriptions.delete(listener) } },
  loadFile: async (_note, reference) => {
    reads.push(reference)
    if (reference === './slow.html') return new Promise(resolve => { finishSlow = resolve })
    if (reference === './missing.html') throw new EmbedFileError('fileReadFailed')
    return '<button>Demo</button>'
  },
})
function Harness() {
  editor = useEditor({ immediatelyRender: false, extensions: [StarterKit, extension], content: {
    type: 'doc', content: [{ type: 'htmlEmbed', attrs: { file: './demo.html', height: 300 } }],
  } })
  return <NextIntlClientProvider locale="en" messages={messages}><EditorContent editor={editor} /></NextIntlClientProvider>
}
const container = document.createElement('div')
document.body.append(container)
const root = createRoot(container)
function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(element => element.textContent === text)
  assert.ok(found, `Button ${text} is visible`)
  return found
}
function update(attributes: Record<string, unknown>) {
  assert.ok(editor)
  const node = editor.state.doc.nodeAt(0)!
  editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...node.attrs, ...attributes }))
}
try {
  await act(async () => { root.render(<Harness />) })
  await act(async () => { button('Run').click() })
  assert.equal(reads.length, 1)
  const documentBefore = container.querySelector('iframe')?.getAttribute('srcdoc')
  assert.ok(documentBefore?.includes('<button>Demo</button>'))
  await act(async () => { update({ height: 400 }) })
  assert.equal(reads.length, 1, 'The first markup update must not reload the file')
  assert.equal(container.querySelector('iframe')?.getAttribute('srcdoc'), documentBefore)
  await act(async () => { button('Expand').click() })
  assert.equal(reads.length, 1)
  await act(async () => { button('Reload file').click() })
  assert.equal(reads.length, 2)
  assert.notEqual(container.querySelector('iframe')?.getAttribute('srcdoc'), documentBefore)
  await act(async () => { update({ file: './missing.html' }) })
  assert.equal(container.querySelector('iframe'), null)
  assert.ok(container.textContent?.includes(messages.editor.htmlEmbed.fileReadFailed))
  await act(async () => { update({ file: '', code: '<p>Inline again</p>' }) })
  assert.ok(!container.textContent?.includes(messages.editor.htmlEmbed.fileReadFailed))
  assert.ok(container.querySelector('iframe')?.getAttribute('srcdoc')?.includes('Inline again'))
  await act(async () => { update({ file: './slow.html', code: '' }) })
  assert.ok(finishSlow)
  await act(async () => {
    notePath = 'other/test.md'
    subscriptions.forEach(listener => listener())
    finishSlow!('<button>Stale content</button>')
  })
  assert.equal(container.querySelector('iframe'), null, 'A stale read cannot resume playback in another note')
  assert.ok(button('Run'))
  console.log('HTML Embed React: stable iframe on markup changes, manual reload, read failures and stale-request cancellation passed.')
} finally {
  await act(async () => { root.unmount() })
  container.remove()
}
