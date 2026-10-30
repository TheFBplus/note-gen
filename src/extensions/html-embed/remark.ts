import { isEmbedFileReference } from './file-path'
import { renderHtmlEmbedMarkdown } from './markdown'

interface MarkdownNode {
  type: string
  lang?: string | null
  meta?: string | null
  value?: string
  children?: MarkdownNode[]
}

/** 普通代码渲染会忽略围栏元数据，导致空正文的文件引用导出成空白。
 * 只读视图及 HTML/PDF 导出显示惰性引用源码；此步骤绝不读取或运行引用文件。
 */
export function remarkHtmlEmbedFiles() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode, depth: number) => {
      if (depth > 64) return
      if (node.type === 'code' && node.lang === 'html-embed' && !node.value?.trim()) {
        try {
          const metadata = JSON.parse(node.meta || '{}')
          if (metadata && metadata.version === 2 && isEmbedFileReference(metadata.file)
            && Object.keys(metadata).every(key => ['version', 'file', 'title', 'height'].includes(key))
            && (metadata.title === undefined || typeof metadata.title === 'string')
            && (metadata.height === undefined || (typeof metadata.height === 'number' && Number.isFinite(metadata.height)))) {
            node.value = renderHtmlEmbedMarkdown({ type: 'htmlEmbed', attrs: metadata })
            node.lang = 'markdown'
            node.meta = null
          }
        } catch { /* 未知或无效格式保留原来的普通代码渲染。 */ }
      }
      node.children?.forEach(child => visit(child, depth + 1))
    }
    visit(tree, 0)
  }
}
