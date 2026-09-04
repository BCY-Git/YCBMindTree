import { useEffect, useState } from 'react'
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

/**
 * HTML 附件卡片 + 全屏预览层。
 *
 * 与图片不同，iframe 不放在节点里：活的 HTML 文档（脚本、动画）既拖累画布性能，
 * 也会和 React Flow 的拖拽手势打架。节点上只放一张轻量卡片，点开后才创建
 * sandbox="allow-scripts" 的 iframe——透明 origin，读不到主应用的存储与接口。
 * 桌面端走 mindtree-preview 自定义协议（自带宽松 CSP），网页端直接用 blob:。
 */
export function AttachmentHtmlPreview({ attachment, variant = 'inspector' }: AttachmentHtmlPreviewProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setUrl(null)
    setMissing(false)
    setFailed(false)
    void (async () => {
      try {
        const stored = await getNodeAttachment(attachment.id)
        if (!active) return
        if (!stored) { setMissing(true); return }
        if (isTauriRuntime()) {
          const base64 = await readBlobAsBase64(stored.blob)
          await invoke('store_html_preview', { id: attachment.id, base64 })
          if (!active) return
          setUrl(desktopPreviewUrl(attachment.id))
        } else {
          objectUrl = URL.createObjectURL(stored.blob)
          setUrl(objectUrl)
        }
      } catch {
        if (active) setFailed(true)
      }
    })()
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment.id])

  useEffect(() => {
    if (!expanded) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [expanded])

  const sizeLabel = `${Math.max(1, Math.ceil(attachment.size / 1024))} KB`
  const card = <button
    className={`attachment-html attachment-html--${variant} nodrag`}
    data-attachment-id={attachment.id}
    aria-label={missing || failed || !url ? `HTML 附件 ${attachment.name}` : `打开 HTML 预览 ${attachment.name}`}
    title={missing || failed || !url ? attachment.name : `打开预览：${attachment.name}；⌘ X 移除附件`}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => { event.stopPropagation(); if (url) setExpanded(true) }}
    onDoubleClick={(event) => event.stopPropagation()}
  >
    <i className="attachment-html__icon" aria-hidden="true">{'</>'}</i>
    <span className="attachment-html__name">{attachment.name}</span>
    <span className="attachment-html__size">
      {missing ? '仅原设备可用' : failed ? '预览失败' : url ? sizeLabel : '读取中…'}
    </span>
  </button>

  const viewer = expanded && url ? createPortal(<div
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
    <iframe
      className="attachment-viewer__frame"
      sandbox="allow-scripts"
      src={url}
      referrerPolicy="no-referrer"
      title={`HTML 预览 ${attachment.name}`}
    />
  </div>, window.document.body) : null

  return <>{card}{viewer}</>
}
