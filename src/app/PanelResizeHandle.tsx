import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

export const panelWidthLimits = { min: 220, max: 420 } as const
export function clampPanelWidth(width: number) {
  return Math.min(panelWidthLimits.max, Math.max(panelWidthLimits.min, Math.round(width)))
}
export function loadPanelWidth(side: 'left' | 'right') {
  try {
    const value = Number(localStorage.getItem(`mindtree.panel-width.${side}.v1`))
    if (Number.isFinite(value) && value > 0) return clampPanelWidth(value)
  } catch { /* 存储不可用时仍可调整侧栏。 */ }
  return side === 'left' ? 256 : 272
}
export function savePanelWidth(side: 'left' | 'right', width: number) {
  try { localStorage.setItem(`mindtree.panel-width.${side}.v1`, String(clampPanelWidth(width))) } catch { /* 保留本次会话宽度。 */ }
}

export function PanelResizeHandle({ side, width, onChange }: { side: 'left' | 'right'; width: number; onChange: (width: number) => void }) {
  const drag = useRef<{ startX: number; startWidth: number; current: number; max: number } | null>(null)
  const availableMax = (handle: HTMLDivElement) => {
    const panel = handle.parentElement
    const workspace = panel?.parentElement
    if (!workspace?.classList.contains('workspace')) return panelWidthLimits.max
    const otherPanels = Array.from(workspace.children).filter((child) => child !== panel && !child.classList.contains('workspace-center'))
    const occupied = otherPanels.reduce((total, child) => total + child.getBoundingClientRect().width, 0)
    return Math.max(panelWidthLimits.min, Math.min(panelWidthLimits.max, workspace.clientWidth - occupied - 240))
  }
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    savePanelWidth(side, drag.current.current)
    drag.current = null
    event.currentTarget.closest('.workspace')?.classList.remove('is-resizing-panel')
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = side === 'left' ? 1 : -1
    const delta = event.key === 'ArrowRight' ? 20 * direction : event.key === 'ArrowLeft' ? -20 * direction : 0
    if (!delta && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const maximum = availableMax(event.currentTarget)
    const next = Math.min(maximum, clampPanelWidth(event.key === 'Home' ? panelWidthLimits.min : event.key === 'End' ? maximum : width + delta))
    onChange(next)
    savePanelWidth(side, next)
  }
  return <div className={`panel-resize-handle panel-resize-handle--${side}`} role="separator" tabIndex={0} aria-label={side === 'left' ? '调整左侧工作区宽度' : '调整右侧属性面板宽度'} aria-orientation="vertical" aria-valuemin={panelWidthLimits.min} aria-valuemax={panelWidthLimits.max} aria-valuenow={width} title="拖动调整宽度；双击恢复默认" onKeyDown={keyboard} onDoubleClick={() => {
    const next = side === 'left' ? 256 : 272
    onChange(next); savePanelWidth(side, next)
  }} onPointerDown={(event) => {
    if (event.button !== 0) return
    event.preventDefault()
    drag.current = { startX: event.clientX, startWidth: event.currentTarget.parentElement?.getBoundingClientRect().width ?? width, current: width, max: availableMax(event.currentTarget) }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.closest('.workspace')?.classList.add('is-resizing-panel')
  }} onPointerMove={(event) => {
    if (!drag.current) return
    const next = Math.min(drag.current.max, clampPanelWidth(drag.current.startWidth + (event.clientX - drag.current.startX) * (side === 'left' ? 1 : -1)))
    drag.current.current = next
    onChange(next)
  }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} />
}
