import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MindNodeAttachment } from '../domain/document.types'
import { getNodeAttachment } from '../persistence/database'

export function AttachmentImage({ attachment, variant = 'inspector' }: { attachment: MindNodeAttachment; variant?: 'node' | 'inspector' }) {
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setUrl(null)
    setMissing(false)
    void getNodeAttachment(attachment.id).then((stored) => {
      if (!active) return
      if (!stored || !attachment.type.startsWith('image/')) { setMissing(true); return }
      objectUrl = URL.createObjectURL(stored.blob)
      setUrl(objectUrl)
    }).catch(() => { if (active) setMissing(true) })
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

  if (missing) return <span className={`attachment-image attachment-image--${variant} is-missing`} title={attachment.name}>仅本机图片不可用</span>
  if (!url) return <span className={`attachment-image attachment-image--${variant} is-loading`} aria-label={`正在载入图片 ${attachment.name}`} />
  const viewer = expanded ? createPortal(<div className="attachment-viewer" role="dialog" aria-modal="true" aria-label={`图片预览 ${attachment.name}`} onMouseDown={() => setExpanded(false)}>
    <header><strong>{attachment.name}</strong><span>仅保存在本机工作区</span><button aria-label="关闭图片预览" onClick={() => setExpanded(false)}>×</button></header>
    <img src={url} alt={attachment.name} onMouseDown={(event) => event.stopPropagation()} />
  </div>, window.document.body) : null
  return <>
    <button className={`attachment-image attachment-image--${variant} nodrag`} aria-label={`查看图片 ${attachment.name}`} title={`查看原图：${attachment.name}`} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setExpanded(true) }}>
      <img src={url} alt={attachment.name} draggable={false} />
      {variant === 'inspector' && <span>{attachment.name}</span>}
    </button>
    {viewer}
  </>
}
