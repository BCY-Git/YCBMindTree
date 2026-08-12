import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clampImageDisplayWidth } from './image-presentation'
import type { MindNodeAttachment, MindNodeAttachmentImage } from '../domain/document.types'
import { getNodeAttachment } from '../persistence/database'

type AttachmentImageProps = {
  attachment: MindNodeAttachment
  variant?: 'node' | 'inspector'
  onImageMeasured?: (image: MindNodeAttachmentImage) => void
  onImageResize?: (image: MindNodeAttachmentImage) => void
}

const fallbackImage: MindNodeAttachmentImage = { width: 16, height: 10, displayWidth: 156 }

export function AttachmentImage({ attachment, variant = 'inspector', onImageMeasured, onImageResize }: AttachmentImageProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [intrinsicImage, setIntrinsicImage] = useState<MindNodeAttachmentImage | null>(null)
  const [previewWidth, setPreviewWidth] = useState<number | null>(null)
  const resizeStartRef = useRef<{ x: number; y: number; width: number; corner: string } | null>(null)
  const previewWidthRef = useRef<number | null>(null)
  const measuredAttachmentRef = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setUrl(null)
    setMissing(false)
    setIntrinsicImage(null)
    setPreviewWidth(null)
    previewWidthRef.current = null
    measuredAttachmentRef.current = null
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

  const image = attachment.image ?? intrinsicImage ?? fallbackImage
  const displayWidth = previewWidth ?? image.displayWidth
  const publishMeasuredImage = (element: HTMLImageElement) => {
    if (attachment.image || measuredAttachmentRef.current === attachment.id || !element.naturalWidth || !element.naturalHeight) return
    const measured = {
      width: element.naturalWidth,
      height: element.naturalHeight,
      displayWidth: clampImageDisplayWidth(Math.min(element.naturalWidth, 260)),
    }
    measuredAttachmentRef.current = attachment.id
    setIntrinsicImage(measured)
    onImageMeasured?.(measured)
  }
  const startResize = (event: React.PointerEvent<HTMLButtonElement>, corner: string) => {
    event.preventDefault()
    event.stopPropagation()
    resizeStartRef.current = { x: event.clientX, y: event.clientY, width: displayWidth, corner }
    previewWidthRef.current = displayWidth
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = resizeStartRef.current
    if (!start) return
    event.preventDefault()
    event.stopPropagation()
    const horizontal = start.corner.includes('left') ? start.x - event.clientX : event.clientX - start.x
    const vertical = start.corner.includes('top') ? start.y - event.clientY : event.clientY - start.y
    const ratio = image.width / image.height
    const verticalAsWidth = vertical * ratio
    const delta = Math.abs(horizontal) >= Math.abs(verticalAsWidth) ? horizontal : verticalAsWidth
    const width = clampImageDisplayWidth(start.width + delta)
    previewWidthRef.current = width
    setPreviewWidth(width)
  }
  const finishResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = resizeStartRef.current
    if (!start) return
    event.preventDefault()
    event.stopPropagation()
    resizeStartRef.current = null
    const width = previewWidthRef.current ?? displayWidth
    setPreviewWidth(null)
    previewWidthRef.current = null
    if (width !== attachment.image?.displayWidth) onImageResize?.({ ...image, displayWidth: width })
  }

  if (missing) return <span className={`attachment-image attachment-image--${variant} is-missing`} title={attachment.name}>仅本机图片不可用</span>
  if (!url) return <span className={`attachment-image attachment-image--${variant} is-loading`} aria-label={`正在载入图片 ${attachment.name}`} />
  const viewer = expanded ? createPortal(<div className="attachment-viewer" role="dialog" aria-modal="true" aria-label={`图片预览 ${attachment.name}`} onMouseDown={() => setExpanded(false)}>
    <header><strong>{attachment.name}</strong><span>仅保存在本机工作区</span><button aria-label="关闭图片预览" onClick={() => setExpanded(false)}>×</button></header>
    <img src={url} alt={attachment.name} onMouseDown={(event) => event.stopPropagation()} />
  </div>, window.document.body) : null
  return <>
    <span className={`attachment-image attachment-image--${variant} nodrag`} style={variant === 'node' ? { '--attachment-display-width': `${displayWidth}px`, '--attachment-aspect-ratio': `${image.width} / ${image.height}` } as React.CSSProperties : undefined} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <button className="attachment-image__preview" aria-label={`查看图片 ${attachment.name}`} title={`查看原图：${attachment.name}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setExpanded(true) }}>
        <img src={url} alt={attachment.name} draggable={false} onLoad={(event) => publishMeasuredImage(event.currentTarget)} />
      </button>
      {variant === 'node' && onImageResize && <span className="attachment-image__resize-layer" aria-label="拖动四角等比例缩放图片">
        {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((corner) => <button key={corner} type="button" className={`attachment-image__resize-handle attachment-image__resize-handle--${corner}`} aria-label={`从${corner.replace('-', ' ')}缩放图片`} onPointerDown={(event) => startResize(event, corner)} onPointerMove={moveResize} onPointerUp={finishResize} onPointerCancel={finishResize} />)}
      </span>}
      {variant === 'inspector' && <span className="attachment-image__name">{attachment.name}</span>}
    </span>
    {viewer}
  </>
}
