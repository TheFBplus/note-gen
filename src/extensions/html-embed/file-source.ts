import { invoke } from '@tauri-apps/api/core'
import { getCurrentEditorWorkspaceRoot } from '@/lib/editor-deactivation'
import { EmbedFileError, resolveEmbedFilePath } from './file-path'
import { MAX_EMBED_CHARACTERS } from './markdown'

export const MAX_EMBED_FILE_BYTES = 512 * 1024

export interface EmbedFileContext { notePath: string; workspaceRoot: string }
type ReadChunk = (root: string, path: string, length: number) => Promise<string>

const nativeRead: ReadChunk = (workspaceRoot, relativePath, length) => invoke<string>('plugin_read_preview_chunk', {
  workspaceRoot, relativePath, offset: 0, length,
})

/** 复用所有平台均注册的原生预览读取命令：原生端逐段拒绝符号链接并检查 canonical 路径。
 * 只返回有限长度的 UTF-8 文本，不给 iframe 文件权限，也不自动下载、修改或创建任何文件。
 */
export async function readHtmlEmbedFile(context: EmbedFileContext, reference: string, read: ReadChunk = nativeRead): Promise<string> {
  const relativePath = resolveEmbedFilePath(context.notePath, reference, context.workspaceRoot)
  let base64: string
  try {
    base64 = await read(context.workspaceRoot, relativePath, MAX_EMBED_FILE_BYTES + 1)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'QuotaExceeded') throw new EmbedFileError('fileTooLarge')
    throw new EmbedFileError('fileReadFailed')
  }
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0)) }
  catch { throw new EmbedFileError('invalidEncoding') }
  if (bytes.length > MAX_EMBED_FILE_BYTES) throw new EmbedFileError('fileTooLarge')
  let code: string
  try { code = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new EmbedFileError('invalidEncoding') }
  if (code.includes('\0')) throw new EmbedFileError('invalidEncoding')
  if (code.length > MAX_EMBED_CHARACTERS) throw new EmbedFileError('fileTooLarge')
  return code
}

export async function loadHtmlEmbedFile(notePath: string, reference: string): Promise<string> {
  return readHtmlEmbedFile({ notePath, workspaceRoot: await getCurrentEditorWorkspaceRoot() }, reference)
}
