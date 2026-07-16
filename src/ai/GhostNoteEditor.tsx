import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MindMapDocument } from '../domain/document.types'
import { isGhostCompletionEnabled, loadAiSettings } from './ai-settings'
import { requestGhostCompletion } from './ghost-completion'

type GhostNoteEditorProps = {
  value: string
  document: MindMapDocument
  nodeId: string
  onChange: (value: string) => void
}

export function GhostNoteEditor({ value, document, nodeId, onChange }: GhostNoteEditorProps) {
  const [suggestion, setSuggestion] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [cursorAtEnd, setCursorAtEnd] = useState(true)
  const [composing, setComposing] = useState(false)
  const requestRef = useRef<AbortController | null>(null)
  const mirrorRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    requestRef.current?.abort()
    setSuggestion('')
    setStatus('idle')
    const settings = loadAiSettings()
    if (composing || !cursorAtEnd || !isGhostCompletionEnabled() || value.trim().length < 3 || !settings.endpoint.trim() || !settings.model.trim() || (!settings.apiKey.trim() && !import.meta.env.DEV)) return
    const controller = new AbortController()
    requestRef.current = controller
    const timer = window.setTimeout(() => {
      setStatus('loading')
      void requestGhostCompletion(settings, document, nodeId, value, controller.signal)
        .then((completion) => { if (!controller.signal.aborted) { setSuggestion(completion); setStatus('idle') } })
        .catch(() => { if (!controller.signal.aborted) { setSuggestion(''); setStatus('error') } })
    }, 650)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [composing, cursorAtEnd, document, nodeId, value])

  const syncMirrorScroll = () => {
    if (!mirrorRef.current || !textareaRef.current) return
    mirrorRef.current.scrollTop = textareaRef.current.scrollTop
    mirrorRef.current.scrollLeft = textareaRef.current.scrollLeft
  }

  useLayoutEffect(syncMirrorScroll, [suggestion])

  const acceptSuggestion = () => {
    if (!suggestion) return false
    onChange(`${value}${suggestion}`)
    setSuggestion('')
    return true
  }

  return <div className={`ghost-note-editor ${suggestion ? 'has-suggestion' : ''}`}>
    <div className="ghost-note-editor__field">
      {suggestion && <div ref={mirrorRef} className="ghost-note-editor__mirror" aria-hidden="true"><span>{value}</span><span className="ghost-note-editor__suggestion">{suggestion}</span></div>}
      <textarea
        ref={textareaRef}
        id="node-note"
        value={value}
        rows={4}
        placeholder="补充背景、结论、待办或讨论记录…"
        onChange={(event) => { setCursorAtEnd(event.target.selectionStart === event.target.value.length); onChange(event.target.value) }}
        onSelect={(event) => setCursorAtEnd(event.currentTarget.selectionStart === event.currentTarget.value.length && event.currentTarget.selectionEnd === event.currentTarget.value.length)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(event) => { setComposing(false); setCursorAtEnd(event.currentTarget.selectionStart === event.currentTarget.value.length) }}
        onScroll={syncMirrorScroll}
        onKeyDown={(event) => {
          if (event.key === 'Tab' && acceptSuggestion()) event.preventDefault()
          if (event.key === 'Escape' && suggestion) { event.preventDefault(); setSuggestion('') }
        }}
        aria-describedby="ghost-note-hint"
      />
    </div>
    <small id="ghost-note-hint" className="ghost-note-editor__hint">{suggestion ? 'Tab 接受建议 · Esc 忽略' : status === 'loading' ? 'AI 正在续写…' : status === 'error' ? 'AI 续写暂不可用' : '在 AI 助手中启用幽灵续写后，停顿片刻即可获得建议。'}</small>
  </div>
}
