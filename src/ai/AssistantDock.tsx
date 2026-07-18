import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

export const assistantDockLimits = { min: 300, max: 520, default: 360 } as const
const assistantDockOpenKey = 'mindtree.assistant-dock-open.v1'
const assistantDockWidthKey = 'mindtree.assistant-dock-width.v1'

export function clampAssistantDockWidth(width: number) {
  return Math.min(assistantDockLimits.max, Math.max(assistantDockLimits.min, Math.round(width)))
}

export function loadAssistantDockOpen() {
  return localStorage.getItem(assistantDockOpenKey) === 'true'
}

export function saveAssistantDockOpen(open: boolean) {
  localStorage.setItem(assistantDockOpenKey, String(open))
}

export function loadAssistantDockWidth() {
  const stored = Number(localStorage.getItem(assistantDockWidthKey))
  return Number.isFinite(stored) && stored > 0 ? clampAssistantDockWidth(stored) : assistantDockLimits.default
}

export function saveAssistantDockWidth(width: number) {
  localStorage.setItem(assistantDockWidthKey, String(clampAssistantDockWidth(width)))
}

export function AssistantDockToggleButton({ open, hasNudge = false, onToggle }: { open: boolean; hasNudge?: boolean; onToggle: () => void }) {
  const label = open ? '收起 AI 助手' : '显示 AI 助手'
  const accessibleLabel = !open && hasNudge ? `${label} · 有待整理记录` : label
  return <button className={`topbar-utility__button assistant-dock-toggle ${open ? 'is-active' : ''} ${!open && hasNudge ? 'has-nudge' : ''}`} onClick={onToggle} title={accessibleLabel} aria-label={accessibleLabel} aria-pressed={open}><span className="toolbar-icon" aria-hidden="true">✦</span>{!open && hasNudge && <i className="assistant-dock-toggle__nudge" aria-hidden="true" />}</button>
}

type AssistantDockProps = {
  width: number
  onWidthChange: (width: number) => void
  onWidthCommit: (width: number) => void
  onClose: () => void
  children: ReactNode
}

export function AssistantDock({ width, onWidthChange, onWidthCommit, onClose, children }: AssistantDockProps) {
  const dragRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null)

  const resizeByKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowLeft' ? 24 : event.key === 'ArrowRight' ? -24 : 0
    const next = event.key === 'Home' ? assistantDockLimits.min : event.key === 'End' ? assistantDockLimits.max : clampAssistantDockWidth(width + delta)
    if (!delta && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    onWidthChange(next)
    onWidthCommit(next)
  }

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: width, currentWidth: width }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const continueResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const next = clampAssistantDockWidth(dragRef.current.startWidth + dragRef.current.startX - event.clientX)
    dragRef.current.currentWidth = next
    onWidthChange(next)
  }

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    onWidthCommit(dragRef.current.currentWidth)
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  return <aside className="assistant-dock" aria-label="AI 助手面板">
    <div className="assistant-dock__resize" role="separator" aria-label="调整 AI 助手宽度" aria-orientation="vertical" aria-valuemin={assistantDockLimits.min} aria-valuemax={assistantDockLimits.max} aria-valuenow={width} tabIndex={0} onKeyDown={resizeByKeyboard} onPointerDown={beginResize} onPointerMove={continueResize} onPointerUp={finishResize} onPointerCancel={finishResize} />
    <header className="assistant-dock__header"><span><i>✦</i><strong>AI 助手</strong><small>基于当前导图</small></span><button onClick={onClose} aria-label="收起 AI 助手">×</button></header>
    <div className="assistant-dock__body">{children}</div>
  </aside>
}
