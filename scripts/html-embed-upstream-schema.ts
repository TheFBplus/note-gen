import StarterKit from '@tiptap/starter-kit'
import CodeBlock from '@tiptap/extension-code-block'
import TaskList from '@tiptap/extension-task-list'
import Underline from '@tiptap/extension-underline'
import { HtmlEmbedNode } from '../src/extensions/html-embed/node'
import { MarkdownParagraph } from '../src/app/core/main/editor/markdown/markdown-paragraph'
import { MarkdownListItem, MarkdownTaskItem } from '../src/app/core/main/editor/markdown/markdown-list-item'
import { MarkdownOrderedList } from '../src/app/core/main/editor/markdown/markdown-ordered-list'
import { ColorHighlight, TextColor } from '../src/app/core/main/editor/markdown/color-marks'
import { SchemaMarkdown } from '../src/app/core/main/editor/markdown/schema-markdown'
import { InlineMath, BlockMath } from '../src/app/core/main/editor/markdown/math-extension'
import { MermaidDiagram } from '../src/app/core/main/editor/markdown/mermaid-extension'
import { WikiMetadata } from '../src/app/core/main/editor/markdown/wiki-metadata-extension'
import { parseFencedCodeBlockToken, renderFencedCodeBlockNode } from '../src/app/core/main/editor/markdown/code-block-markdown'

/** 与生产编辑器使用相同的解析扩展及声明顺序，避免简化 schema 掩盖升级问题。 */
export function combinedMarkdownExtensions() {
  return [
    StarterKit.configure({ codeBlock: false, paragraph: false, listItem: false, orderedList: false, underline: false }),
    MarkdownParagraph, MarkdownListItem, MarkdownOrderedList,
    TaskList, MarkdownTaskItem.configure({ nested: true }),
    CodeBlock.extend({ parseMarkdown: parseFencedCodeBlockToken, renderMarkdown: renderFencedCodeBlockNode }),
    ColorHighlight, TextColor, Underline, SchemaMarkdown,
    InlineMath, BlockMath, MermaidDiagram, WikiMetadata, HtmlEmbedNode,
  ]
}
