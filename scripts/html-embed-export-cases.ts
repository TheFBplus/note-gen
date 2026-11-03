import assert from 'node:assert/strict'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { StreamdownRenderer } from '../src/components/markdown/streamdown-renderer'
import { ChatResponseContext } from '../src/components/chat-ui/response-context'
import { EMPTY_ARTIFACT_LINKS } from '../src/components/markdown/artifact-link'
import english from '../messages/en.json'
import { remarkHtmlEmbedFiles } from '../src/extensions/html-embed/remark'
import { remarkSourceLinks, sourceLinkIndex } from '../src/components/markdown/remark-source-links'
import { renderMarkdownExportFragment } from '../src/lib/markdown/export-document'

// 两个真实 remark 插件同时处理代码/来源链接，各自不改写对方节点。
const tree = { type: 'root', children: [
  { type: 'code', lang: 'html-embed', meta: '{"version":2,"file":"./embeds/demo.html","height":360}', value: '' },
  { type: 'paragraph', children: [{ type: 'link', url: 'article:notes/source.md', children: [{ type: 'text', value: 'Source' }] }] },
] }
remarkHtmlEmbedFiles()(tree)
remarkSourceLinks({ sourceKeys: ['article:notes/source.md'] })(tree)
assert.equal(tree.children[0].lang, 'markdown')
assert.ok(tree.children[0].value?.includes('./embeds/demo.html'))
assert.equal(sourceLinkIndex(tree.children[1].children?.[0].url), 0)

const markdown = [
  'Before.',
  '```html-embed\n<script>window.__exportExecuted = true</script><button>Button</button>\n```',
  '```html-embed {"version":2,"file":"./embeds/demo.html","height":360}\n\n```',
  '[Source](https://example.com/source)',
].join('\n\n')
// 与 HTML/PDF 共用的真实导出渲染入口。缺少 next-intl 的全局环境不影响惰性代码导出。
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
const result = await renderMarkdownExportFragment(markdown)
const container = document.createElement('div')
container.innerHTML = result.html
assert.ok(container.textContent?.includes('window.__exportExecuted = true'))
assert.ok(container.textContent?.includes('./embeds/demo.html'))
assert.equal(container.querySelector('a')?.getAttribute('href'), 'https://example.com/source')
assert.equal(container.querySelector('script,iframe'), null)
assert.equal((window as unknown as Record<string, unknown>).__exportExecuted, undefined)
// 同一 Markdown 的来源顺序变化时，真实渲染器必须刷新 remark 输出。
const target = document.createElement('div')
document.body.append(target)
const root = createRoot(target)
try {
  for (const sources of [[{ sourceKey: 'article:notes/source.md' }], [{ sourceKey: 'article:notes/other.md' }, { sourceKey: 'article:notes/source.md' }]]) {
    flushSync(() => root.render(createElement(NextIntlClientProvider, {
      locale: 'en', timeZone: 'UTC', messages: english,
    }, createElement(ChatResponseContext.Provider, {
        value: { sources, artifacts: EMPTY_ARTIFACT_LINKS, isPreview: true },
      }, createElement(StreamdownRenderer, { markdown: '[Wiki source](article:notes/source.md)' })),
    )))
    assert.equal(target.querySelector('a')?.getAttribute('href'), `#notegen-source-${sources.length - 1}`)
    assert.ok(target.textContent?.includes('Wiki source'))
  }
} finally { root.unmount(); target.remove() }
console.log('HTML Embed export: real HTML/PDF rendering preserves inert inline source, file references and ordinary links; Wiki source-link plugin coexists.')
