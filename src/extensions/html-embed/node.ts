import { Node, mergeAttributes } from '@tiptap/core'
import { DEFAULT_EMBED_HEIGHT, embedHeight, htmlEmbedTokenizer, renderHtmlEmbedMarkdown } from './markdown'
import { isEmbedFileReference } from './file-path'

/** 独立于 React 的持久化节点，便于验证 Markdown 往返；不接入插件宿主能力。 */
export const HtmlEmbedNode = Node.create({
  name: 'htmlEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      code: { default: '', rendered: false },
      file: { default: '', rendered: false },
      title: { default: '', rendered: false },
      height: { default: DEFAULT_EMBED_HEIGHT, rendered: false },
    }
  },
  parseHTML() {
    return [{
      tag: 'pre[data-notegen-html-embed]',
      priority: 100,
      getAttrs: element => {
        const version = element.getAttribute('data-notegen-html-embed')
        const file = element.getAttribute('data-file') ?? ''
        if (version !== '1' && version !== '2') return false
        if (version === '2' && !isEmbedFileReference(file)) return false
        return {
          code: version === '2' ? '' : element.textContent ?? '',
          file: version === '2' ? file : '',
          title: element.getAttribute('data-title') ?? '',
          height: embedHeight(element.getAttribute('data-height') ?? DEFAULT_EMBED_HEIGHT),
        }
      },
    }]
  },
  // 剪贴板 HTML 仅携带惰性源码。粘贴时恢复节点，绝不把运行中的 iframe 复制到宿主。
  renderHTML({ node, HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes, {
      'data-notegen-html-embed': node.attrs.file ? '2' : '1',
      ...(node.attrs.file ? { 'data-file': node.attrs.file } : {}),
      'data-title': node.attrs.title,
      'data-height': node.attrs.height,
    }), ['code', {}, node.attrs.file ? renderHtmlEmbedMarkdown(node.toJSON()) : node.attrs.code]]
  },
  markdownTokenName: 'html_embed',
  markdownTokenizer: htmlEmbedTokenizer,
  parseMarkdown(token) {
    return { type: 'htmlEmbed', attrs: token.attrs }
  },
  renderMarkdown: renderHtmlEmbedMarkdown,
})
