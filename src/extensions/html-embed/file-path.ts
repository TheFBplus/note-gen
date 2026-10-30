export class EmbedFileError extends Error {
  constructor(public readonly code: 'invalidPath' | 'missingNote' | 'fileReadFailed' | 'fileTooLarge' | 'invalidEncoding') {
    super(code)
    this.name = 'EmbedFileError'
  }
}

const absolute = (path: string) => /^(?:[a-z]:|\/|\\)/i.test(path)

/** 引用是文件名而非 URL；不解码 % 转义，不接受协议、查询参数或 Windows ADS。 */
export function isEmbedFileReference(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && value.trim().length > 0
    && !absolute(value.trim()) && !/[\x00-\x1f\x7f:?#<>"|*\\]/.test(value)
    && /\.html?$/i.test(value.trim())
}

function segments(path: string): string[] {
  const result: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!result.length) throw new EmbedFileError('invalidPath')
      result.pop()
    } else {
      if (part.endsWith('.') || part.endsWith(' ') || /[\x00-\x1f\x7f:?#<>"|*]/.test(part)) throw new EmbedFileError('invalidPath')
      result.push(part)
    }
  }
  return result
}

function workspaceRelative(path: string, root: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (!absolute(normalized)) return normalized
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const windows = /^[a-z]:/i.test(base)
  const candidate = windows ? normalized.toLowerCase() : normalized
  const prefix = windows ? base.toLowerCase() : base
  if (!base || !candidate.startsWith(prefix + '/')) throw new EmbedFileError('invalidPath')
  return normalized.slice(base.length + 1)
}

export function resolveEmbedFilePath(notePath: string, reference: string, workspaceRoot: string): string {
  if (!notePath || !/\.md$/i.test(notePath)) throw new EmbedFileError('missingNote')
  if (!isEmbedFileReference(reference)) throw new EmbedFileError('invalidPath')
  const note = segments(workspaceRelative(notePath, workspaceRoot))
  note.pop()
  const target = segments([...note, reference.trim()].join('/')).join('/')
  if (!target || target.length > 1024) throw new EmbedFileError('invalidPath')
  return target
}

/** 文件选择器返回绝对路径；转换成相对当前笔记的引用后再保存，不写入设备专属路径。 */
export function selectedEmbedReference(notePath: string, selectedPath: string, workspaceRoot: string): string {
  const target = segments(workspaceRelative(selectedPath, workspaceRoot))
  if (!/\.html?$/i.test(target.at(-1) ?? '')) throw new EmbedFileError('invalidPath')
  if (!notePath || !/\.md$/i.test(notePath)) throw new EmbedFileError('missingNote')
  const parent = segments(workspaceRelative(notePath, workspaceRoot))
  parent.pop()
  let common = 0
  while (common < parent.length && parent[common] === target[common]) common++
  const reference = [...parent.slice(common).map(() => '..'), ...target.slice(common)].join('/')
  const result = reference.startsWith('..') ? reference : './' + reference
  resolveEmbedFilePath(notePath, result, workspaceRoot)
  return result
}
