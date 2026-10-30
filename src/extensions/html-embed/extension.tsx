'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ReactNodeViewRenderer, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription,
  ResponsiveDialogFooter, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from '@/components/responsive-dialog'
import { HtmlEmbedNode } from './node'
import { buildEmbedDocument } from './sandbox'
import { getCurrentEditorWorkspaceRoot } from '@/lib/editor-deactivation'
import { EmbedFileError, isEmbedFileReference, selectedEmbedReference } from './file-path'
import { loadHtmlEmbedFile } from './file-source'
import { DEFAULT_EMBED_HEIGHT, embedHeight, HTML_EMBED_EXAMPLE, MAX_EMBED_CHARACTERS } from './markdown'

export interface HtmlEmbedOptions {
  getDocumentPath: () => string
  subscribeDocumentChange: (listener: () => void) => () => void
  loadFile: (notePath: string, reference: string) => Promise<string>
}

function HtmlEmbedView({ node, editor, extension, updateAttributes, deleteNode, getPos }: ReactNodeViewProps) {
  // 固定本 NodeView 的初始配置；Tiptap 属性更新可能更换 extension 代理，不能据此重读文件。
  const [options] = useState(() => extension.options as HtmlEmbedOptions)
  const t = useTranslations('editor.htmlEmbed')
  const [editing, setEditing] = useState(!node.attrs.code && !node.attrs.file && editor.isEditable)
  const [sourceMode, setSourceMode] = useState(node.attrs.file ? 'file' : 'inline')
  const [fileDraft, setFileDraft] = useState(String(node.attrs.file || ''))
  const [pickerError, setPickerError] = useState('')
  const [loadedFile, setLoadedFile] = useState<{ file: string; notePath: string; code: string } | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [readError, setReadError] = useState('')
  const requestId = useRef(0)
  const [draft, setDraft] = useState(node.attrs.code || HTML_EMBED_EXAMPLE)
  const [title, setTitle] = useState(String(node.attrs.title))
  const [height, setHeight] = useState(Number(node.attrs.height))
  const [running, setRunning] = useState(false)
  const [revision, setRevision] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const file = String(node.attrs.file || '')
  const inlineCode = String(node.attrs.code)
  const code = file ? (loadedFile?.file === file && loadedFile.notePath === options.getDocumentPath() ? loadedFile.code : null) : inlineCode

  useEffect(() => () => { requestId.current++ }, [])

  // 切换笔记/工作区即取消旧请求，防止同一个相对引用带入另一篇笔记的运行结果。
  useEffect(() => options.subscribeDocumentChange(() => {
    requestId.current++
    setRunning(false)
    setLoadedFile(null)
    setLoadingFile(false)
    setReadError('')
    setEditing(false)
  }), [options])

  useEffect(() => {
    if (!running || !file) {
      setLoadedFile(null)
      setLoadingFile(false)
      setReadError('')
      return
    }
    const request = ++requestId.current
    const notePath = options.getDocumentPath()
    let alive = true
    setLoadedFile(null)
    setReadError('')
    setLoadingFile(true)
    void options.loadFile(notePath, file).then(html => {
      if (alive && request === requestId.current && notePath === options.getDocumentPath()) setLoadedFile({ file, notePath, code: html })
    }).catch(reason => {
      if (alive && request === requestId.current) setReadError(reason instanceof EmbedFileError ? reason.code : 'fileReadFailed')
    }).finally(() => {
      if (alive && request === requestId.current) setLoadingFile(false)
    })
    return () => { alive = false }
  }, [file, revision, running, options])

  const run = () => {
    requestId.current++
    setReadError('')
    setLoadedFile(null)
    setRunning(true)
    setRevision(value => value + 1)
  }
  const stop = () => {
    requestId.current++
    setRunning(false)
    setLoadedFile(null)
    setLoadingFile(false)
    setReadError('')
  }
  // 只在源码或显式重运行时换文档。高度、选区、正文输入和编辑面板不改变 srcDoc。
  const document = useMemo(() => {
    if (!running || code === null || code.length > MAX_EMBED_CHARACTERS) return null
    const token = crypto.randomUUID()
    return { token, html: buildEmbedDocument(code, token) }
  }, [code, revision, running])

  useEffect(() => {
    setError('')
    setReady(false)
    if (!document) return
    const timeout = setTimeout(() => setError(t('timeout')), 15_000)
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.token !== document.token) return
      if (event.data.type === 'html-embed:ready') {
        clearTimeout(timeout)
        setReady(true)
      } else if (event.data.type === 'html-embed:error') {
        clearTimeout(timeout)
        setError(String(event.data.message ?? '').slice(0, 1000))
      }
    }
    window.addEventListener('message', receive)
    return () => { clearTimeout(timeout); window.removeEventListener('message', receive) }
  }, [document, t])

  const edit = () => {
    if (!editor.isEditable) return
    setDraft(inlineCode || HTML_EMBED_EXAMPLE)
    setSourceMode(file ? 'file' : 'inline')
    setFileDraft(file)
    setPickerError('')
    setTitle(String(node.attrs.title))
    setHeight(Number(node.attrs.height))
    setEditing(true)
  }
  const apply = () => {
    if (!editor.isEditable || (sourceMode === 'inline' ? draft.length > MAX_EMBED_CHARACTERS : !isEmbedFileReference(fileDraft) || !options.getDocumentPath())) return
    updateAttributes({ code: sourceMode === 'file' ? '' : draft, file: sourceMode === 'file' ? fileDraft.trim() : '', title, height: embedHeight(height) })
    run()
    setEditing(false)
  }
  const chooseFile = async () => {
    setPickerError('')
    const notePath = options.getDocumentPath()
    const request = requestId.current
    try {
      const root = await getCurrentEditorWorkspaceRoot()
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: false, directory: false, defaultPath: root, filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] })
      if (typeof selected !== 'string' || options.getDocumentPath() !== notePath || request !== requestId.current) return
      setFileDraft(selectedEmbedReference(notePath, selected, root))
    } catch (reason) {
      setPickerError(reason instanceof EmbedFileError ? reason.code : 'filePickerFailed')
    }
  }
  const invalidFile = sourceMode === 'file' && !isEmbedFileReference(fileDraft)
  const missingNote = sourceMode === 'file' && !options.getDocumentPath()
  const tooLarge = sourceMode === 'inline' && draft.length > MAX_EMBED_CHARACTERS
  const returnToNote = () => {
    setExpanded(false)
    if (!editor.isEditable) { editor.commands.focus(); return }
    const position = getPos()
    if (typeof position !== 'number') return
    const after = position + node.nodeSize
    if (editor.state.doc.nodeAt(after)?.isTextblock) {
      editor.chain().focus().setTextSelection(after + 1).run()
    } else {
      editor.chain().focus().setNodeSelection(position).createParagraphNear().run()
    }
  }

  return <NodeViewWrapper contentEditable={false} className="my-3 min-w-0" data-html-embed-view="">
    <div className={expanded ? 'fixed inset-0 z-50 flex flex-col overflow-auto bg-background p-3' : 'overflow-hidden rounded-lg border bg-background'}>
      <div className="flex flex-wrap items-center gap-1 border-b p-2">
        <span className="mr-auto max-w-full truncate px-1 text-sm font-medium">{node.attrs.title || t('title')}</span>
        {editor.isEditable && <Button type="button" size="sm" variant="ghost" onClick={edit}>{t(file ? 'editReference' : 'edit')}</Button>}
        <Button type="button" size="sm" variant="ghost" disabled={loadingFile || (!file && (!inlineCode || inlineCode.length > MAX_EMBED_CHARACTERS))} onClick={run}>{loadingFile ? t('loading') : running ? t(file ? 'reloadFile' : 'restart') : t('run')}</Button>
        {running && <Button type="button" size="sm" variant="ghost" onClick={stop}>{t('stop')}</Button>}
        <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded(value => !value)}>{expanded ? t('collapse') : t('expand')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={returnToNote}>{t('return')}</Button>
        {editor.isEditable && <Button type="button" size="sm" variant="ghost" onClick={() => { if (editor.isEditable) deleteNode() }}>{t('delete')}</Button>}
      </div>
      <p className="px-3 py-2 text-xs text-muted-foreground">{t('notice')}</p>
      {file && <p className="break-all px-3 pb-2 text-xs text-muted-foreground">{t('referencedFile')}: {file}</p>}
      {readError && <p role="alert" className="px-3 pb-2 text-sm text-destructive">{t(readError)}</p>}
      {code !== null && code.length > MAX_EMBED_CHARACTERS && <p role="alert" className="px-3 pb-2 text-sm text-destructive">{t('tooLarge')}</p>}
      {error && <p role="alert" className="whitespace-pre-wrap break-words px-3 pb-2 text-sm text-destructive">{error}</p>}
      {document ? <>
        {!ready && !error && <p role="status" className="px-3 text-sm">{t('loading')}</p>}
        <iframe
          ref={frame}
          key={document.token}
          title={node.attrs.title || t('title')}
          sandbox="allow-scripts"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
          referrerPolicy="no-referrer"
          srcDoc={document.html}
          className="block w-full shrink-0 border-0 bg-white"
          style={{ height: expanded ? 'calc(100dvh - 160px)' : embedHeight(node.attrs.height) }}
        />
      </> : !readError && <div className="p-4 text-sm text-muted-foreground">{loadingFile ? t('loading') : t('paused')}</div>}
    </div>
    <ResponsiveDialog open={editing} onOpenChange={setEditing}>
      <ResponsiveDialogContent className="flex max-h-[90dvh] flex-col gap-3 overflow-y-auto p-4 sm:max-w-3xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t(sourceMode === 'file' ? 'editReference' : 'edit')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t(sourceMode === 'file' ? 'fileHint' : 'description')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <label className="space-y-1 text-sm">{t('source')}
          <select value={sourceMode} onChange={event => { setSourceMode(event.target.value); setPickerError('') }} className="block w-full rounded-md border bg-background p-2">
            <option value="inline">{t('inlineSource')}</option><option value="file">{t('fileSource')}</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">{t('label')}<Input value={title} maxLength={160} onChange={event => setTitle(event.target.value)} /></label>
        <label className="space-y-1 text-sm">{t('height')}<Input type="number" min={120} max={1200} value={height} onChange={event => setHeight(Number(event.target.value))} /></label>
        {sourceMode === 'file' ? <div className="space-y-2">
          <label className="block space-y-1 text-sm">{t('filePath')}<Input value={fileDraft} placeholder="./embeds/demo.html" onChange={event => setFileDraft(event.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label>
          <Button type="button" variant="outline" onClick={() => void chooseFile()}>{t('chooseFile')}</Button>
          {(pickerError || missingNote || (fileDraft && invalidFile)) && <p role="alert" className="text-sm text-destructive">{t(pickerError || (missingNote ? 'missingNote' : 'invalidPath'))}</p>}
        </div> : <label className="flex min-h-0 flex-col gap-1 text-sm">HTML
          <Textarea data-vaul-no-drag value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" className="min-h-[35dvh] resize-y font-mono text-base" />
        </label>}
        {tooLarge && <p role="alert" className="text-sm text-destructive">{t('tooLarge')}</p>}
        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" onClick={() => setEditing(false)}>{t('cancel')}</Button>
          <Button type="button" disabled={tooLarge || invalidFile || missingNote} onClick={apply}>{t('apply')}</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  </NodeViewWrapper>
}

export const HtmlEmbed = HtmlEmbedNode.extend<HtmlEmbedOptions>({
  addOptions() {
    return { getDocumentPath: () => '', subscribeDocumentChange: () => () => {}, loadFile: loadHtmlEmbedFile }
  },
  addNodeView() {
    return ReactNodeViewRenderer(HtmlEmbedView, {
      update: ({ oldNode, newNode, updateProps }) => {
        if (oldNode.type !== newNode.type) return false
        if (!oldNode.sameMarkup(newNode)) updateProps()
        return true
      },
    })
  },
})

export const EMPTY_HTML_EMBED = { type: 'htmlEmbed', attrs: { code: '', file: '', title: '', height: DEFAULT_EMBED_HEIGHT } }
