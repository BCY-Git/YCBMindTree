import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import type { MindNodeAttachment } from '../domain/document.types'
import { getNodeAttachment } from '../persistence/database'
import { isTauriRuntime } from '../platform/tauri'
import { desktopPreviewUrl, readBlobAsBase64 } from './html-attachment'

type AttachmentHtmlPreviewProps = {
  attachment: MindNodeAttachment
  variant?: 'node' | 'inspector'
}

type LoadState = 'idle' | 'loading' | 'ready' | 'missing' | 'failed'

/**
 * HTML 预览地址按附件 id 缓存：节点滚出视口会被 React Flow 卸载，
 * 滚回来时不能重复走一遍 base64 上传（桌面端）或重建 blob。
 * 页面存续期内不 revoke，泄漏上限 = 附件数量，可接受。
 */
const previewUrlCache = new Map<string, string>()

async function resolvePreviewUrl(attachmentId: string): Promise<string> {
  const cached = previewUrlCache.get(attachmentId)
  if (cached) return cached
  const stored = await getNodeAttachment(attachmentId)
  if (!stored) throw new Error('missing')
  let url: string | null
  if (isTauriRuntime()) {
    const base64 = await readBlobAsBase64(stored.blob)
    await invoke('store_html_preview', { id: attachmentId, base64 })
    url = desktopPreviewUrl(attachmentId)
  } else {
    url = URL.createObjectURL(stored.blob)
  }
  if (!url) throw new Error('invalid-id')
  previewUrlCache.set(attachmentId, url)
  return url
}

/** 节点进入视口才创建 iframe；React Flow 的 onlyRenderVisibleElements 已挡掉大部分，这是兜底。 */
function useVisibleOnce<T extends Element>() {
  const ref = useRef<T | null>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, visible }
}

/**
 * HTML 附件预览：节点内直接渲染活的 HTML 文档（sandbox 透明源 iframe），
 * 顶栏可拖动节点、可放大；Inspector 里是卡片，点击打开全屏预览。
 * 桌面端走 mindtree-preview 自定义协议（自带宽松 CSP），网页端用 blob:。
 */
export function AttachmentHtmlPreview({ attachment, variant = 'inspector' }: AttachmentHtmlPreviewProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('idle')
  const [expanded, setExpanded] = useState(false)
  const { ref, visible } = useVisibleOnce<HTMLDivElement>()
  const shouldLoad = visible || expanded

  useEffect(() => {
    if (!shouldLoad) return
    let active = true
    setState((current) => current === 'ready' ? current : 'loading')
    resolvePreviewUrl(attachment.id)
      .then((resolved) => {
        if (!active) return
        setUrl(resolved)
        setState('ready')
      })
      .catch((error: unknown) => {
        if (!active) return
        setState(error instanceof Error && error.message === 'missing' ? 'missing' : 'failed')
      })
    return () => { active = false }
  }, [attachment.id, shouldLoad])

  useEffect(() => {
    if (!expanded) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [expanded])

  const openViewer = useCallback(() => setExpanded(true), [])

  const placeholderText = state === 'missing' ? '仅原设备可用' : state === 'failed' ? '预览失败' : ''
  const viewer = expanded ? createPortal(<div
    className="attachment-viewer"
    role="dialog"
    aria-modal="true"
    aria-label={`HTML 预览 ${attachment.name}`}
    onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false) }}
  >
    <header>
      <strong>{attachment.name}</strong>
      <span>沙箱预览 · 仅保存在本机工作区 · 按 Esc 关闭</span>
      <button aria-label="关闭 HTML 预览" onClick={() => setExpanded(false)}>×</button>
    </header>
    {url
      ? <iframe
          className="attachment-viewer__frame"
          sandbox="allow-scripts"
          src={url}
          referrerPolicy="no-referrer"
          title={`HTML 预览 ${attachment.name}`}
        />
      : <p className="attachment-viewer__status" role="status">{placeholderText || '正在载入预览…'}</p>}
  </div>, window.document.body) : null

  if (variant === 'node') {
    return <>
      <div ref={ref} className="attachment-html-embed" onPointerDown={(event) => event.stopPropagation()}>
        <div className="attachment-html-embed__bar" data-attachment-id={attachment.id}>
          <i aria-hidden="true">{'</>'}</i>
          <span className="attachment-html-embed__name">{attachment.name}</span>
          <button
            type="button"
            className="attachment-html-embed__open nodrag"
            aria-label={`放大预览 ${attachment.name}`}
            title={`放大预览：${attachment.name}；⌘ X 移除附件`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); openViewer() }}
          >⤢</button>
        </div>
        {url
          ? <iframe
              className="attachment-html-embed__frame"
              sandbox="allow-scripts"
              src={url}
              referrerPolicy="no-referrer"
              title={`HTML 预览 ${attachment.name}`}
            />
          : <div className={`attachment-html-embed__frame is-${state}`} aria-label={`正在载入 HTML ${attachment.name}`}>{placeholderText}</div>}
      </div>
      {viewer}
    </>
  }

  return <>
    <button
      className={`attachment-html attachment-html--inspector nodrag`}
      data-attachment-id={attachment.id}
      aria-label={state === 'ready' ? `打开 HTML 预览 ${attachment.name}` : `HTML 附件 ${attachment.name}`}
      title={state === 'ready' ? `打开预览：${attachment.name}` : attachment.name}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); openViewer() }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <i className="attachment-html__icon" aria-hidden="true">{'</>'}</i>
      <span className="attachment-html__name">{attachment.name}</span>
      <span className="attachment-html__size">
        {state === 'missing' ? '仅原设备可用' : state === 'failed' ? '预览失败' : `${Math.max(1, Math.ceil(attachment.size / 1024))} KB`}
      </span>
    </button>
    {viewer}
  </>
}
