import type { JSONContent, MarkdownTokenizer } from '@tiptap/core'
import { isEmbedFileReference } from './file-path'

export const DEFAULT_EMBED_HEIGHT = 360
export const MAX_EMBED_CHARACTERS = 256 * 1024

export function embedHeight(value: unknown): number {
  const height = Number(value)
  return Number.isFinite(height) ? Math.max(120, Math.min(1200, Math.round(height))) : DEFAULT_EMBED_HEIGHT
}

/** 围栏正文是不可解释的 HTML；不交给 Markdown 处理其中的标签和反引号。
 * 不支持的元数据版本回退为普通代码块，以免升级或降级时丢失原文。
 */
export const htmlEmbedTokenizer: MarkdownTokenizer = {
  name: 'html_embed',
  level: 'block',
  start: source => source.search(/^ {0,3}(?:`{3,}|~{3,})html-embed(?:[ \t]|\r?$)/m),
  tokenize(source) {
    const opening = /^ {0,3}(`{3,}|~{3,})html-embed([^\r\n]*)(?:\r?\n|$)/.exec(source)
    if (!opening) return undefined
    let metadata: { version?: number; height?: number; title?: string; file?: string } = {}
    try {
      if (opening[2].trim()) metadata = JSON.parse(opening[2].trim())
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
        || (metadata.version !== undefined && metadata.version !== 1 && metadata.version !== 2)
        || Object.keys(metadata).some(key => !['version', 'height', 'title', 'file'].includes(key))
        || (metadata.height !== undefined && (typeof metadata.height !== 'number' || !Number.isFinite(metadata.height)))
        || (metadata.title !== undefined && typeof metadata.title !== 'string')
        || (metadata.version === 2 ? !isEmbedFileReference(metadata.file) : metadata.file !== undefined)) return undefined
    } catch { return undefined }

    const marker = opening[1][0]
    const closing = new RegExp(`^ {0,3}${marker}{${opening[1].length},}[ \\t]*(?:\\r?\\n|$)`, 'm')
    const rest = source.slice(opening[0].length)
    const end = closing.exec(rest)
    // 与 CommonMark 一致，未闭合的围栏延续到文末，保存时补上结束围栏。
    const code = rest.slice(0, end?.index ?? rest.length).replace(/\r?\n$/, '')
    // 引用模式不接受正文，避免把混合格式里的用户 HTML 悄悄丢弃。
    if (metadata.version === 2 && code.trim()) return undefined
    return {
      type: 'html_embed',
      raw: opening[0] + (end ? rest.slice(0, end.index + end[0].length) : rest),
      content: code,
      attrs: { code: metadata.version === 2 ? '' : code, file: metadata.file?.trim() ?? '', height: embedHeight(metadata.height ?? DEFAULT_EMBED_HEIGHT), title: metadata.title ?? '' },
      tokens: [],
    }
  },
}

export function renderHtmlEmbedMarkdown(node: JSONContent): string {
  const file = String(node.attrs?.file ?? '').trim()
  const code = file ? '' : String(node.attrs?.code ?? '')
  const metadata = JSON.stringify({ version: file ? 2 : 1, ...(file ? { file } : {}), height: embedHeight(node.attrs?.height ?? DEFAULT_EMBED_HEIGHT), title: String(node.attrs?.title ?? '') })
  // CommonMark 禁止反引号围栏的信息串包含反引号；标题包含它时改用波浪线。
  const marker = metadata.includes('`') ? '~' : '`'
  const runs = code.match(marker === '`' ? /`+/g : /~+/g) ?? []
  const fence = marker.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3))
  return `${fence}html-embed ${metadata}\n${code}\n${fence}`
}

export const HTML_EMBED_EXAMPLE = `<style>
  body { font: 16px system-ui; padding: 16px; }
  button, input { font: inherit; padding: 8px; max-width: 100%; }
</style>
<label>Name <input placeholder="Your name"></label>
<button id="counter">Count: 0</button>
<script>
  let count = 0;
  document.querySelector('#counter').onclick = event => {
    event.currentTarget.textContent = 'Count: ' + (++count);
  };
</script>`
