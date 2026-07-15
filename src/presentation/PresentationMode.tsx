import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { MindMapDocument } from '../domain/document.types'
import { getTheme } from '../domain/themes'
import { buildPresentationSteps } from './presentation-model'

export function PresentationMode({ document, startNodeId, onClose }: { document: MindMapDocument; startNodeId: string; onClose: () => void }) {
  const steps = useMemo(() => buildPresentationSteps(document, startNodeId), [document, startNodeId])
  const [index, setIndex] = useState(0)
  const [showNote, setShowNote] = useState(false)
  const step = steps[index]
  const theme = getTheme(document.theme.id)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(event.key)) { event.preventDefault(); setShowNote(false); setIndex((current) => Math.min(steps.length - 1, current + 1)) }
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); setShowNote(false); setIndex((current) => Math.max(0, current - 1)) }
      if (event.key.toLowerCase() === 'n') setShowNote((visible) => !visible)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, steps.length])

  if (!step) return null
  return <section className="presentation-mode" role="dialog" aria-modal="true" aria-label="导图演示" style={{ '--presentation-bg': theme.canvas, '--presentation-surface': theme.surface, '--presentation-text': theme.nodeText, '--presentation-accent': theme.selected } as CSSProperties}>
    <header className="presentation-mode__header"><span className="brand-mark">M</span><strong>{document.title}</strong><nav>{step.path.map((topic, pathIndex) => <span key={`${topic}-${pathIndex}`}>{topic}</span>)}</nav><button onClick={() => { void window.document.documentElement?.requestFullscreen?.() }} title="进入系统全屏">全屏</button><button onClick={onClose}>退出 <kbd>Esc</kbd></button></header>
    <main className="presentation-mode__stage">
      <p className="eyebrow">{index + 1} / {steps.length}</p>
      <h1>{step.topic}</h1>
      {step.childTopics.length > 0 && <div className="presentation-mode__children">{step.childTopics.map((topic) => <span key={topic}>{topic}</span>)}</div>}
      {showNote && step.note.trim() && <aside className="presentation-mode__note"><strong>演讲备注</strong><p>{step.note}</p></aside>}
    </main>
    <footer className="presentation-mode__footer"><button disabled={index === 0} onClick={() => { setShowNote(false); setIndex((current) => Math.max(0, current - 1)) }}>← 上一步</button><button aria-label={showNote ? '隐藏演讲备注' : '显示演讲备注'} disabled={!step.note.trim()} onClick={() => setShowNote((visible) => !visible)}>{showNote ? '隐藏备注' : '显示备注'} <kbd>N</kbd></button><button disabled={index === steps.length - 1} onClick={() => { setShowNote(false); setIndex((current) => Math.min(steps.length - 1, current + 1)) }}>下一步 →</button></footer>
  </section>
}
