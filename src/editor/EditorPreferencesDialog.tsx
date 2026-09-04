import { useEffect, useRef } from 'react'
import { Cross2Icon, InfoCircledIcon } from '@radix-ui/react-icons'
import type { EditorPreferences, FloatingToolbarVisibility } from './editor-preferences'

const toolbarDescriptions: Record<FloatingToolbarVisibility, string> = {
  always: '选中主题时立即显示浮动工具栏。',
  hover: '选中主题后，鼠标移入主题时显示工具栏。',
  never: '选中主题时不显示浮动工具栏。',
}

export function EditorPreferencesDialog({ open, preferences, onChange, onClose }: {
  open: boolean
  preferences: EditorPreferences
  onChange: (preferences: EditorPreferences) => void
  onClose: () => void
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus({ preventScroll: true })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="editor-preferences-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="editor-preferences-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-preferences-title">
        <header className="editor-preferences-dialog__header">
          <div>
            <p className="eyebrow">设置 · 编辑器</p>
            <h2 id="editor-preferences-title">自定义你的编辑习惯</h2>
            <p>按你的使用方式，决定节点工具在什么时候出现。</p>
          </div>
          <button ref={closeButtonRef} type="button" className="editor-preferences-dialog__close" aria-label="关闭编辑器设置" onClick={onClose}><Cross2Icon /></button>
        </header>

        <div className="editor-preferences-list">
          <label className="editor-preference-row" htmlFor="floating-toolbar-visibility">
            <span><strong>显示浮动工具栏</strong><small>{toolbarDescriptions[preferences.floatingToolbarVisibility]}</small></span>
            <select id="floating-toolbar-visibility" aria-label="显示浮动工具栏" value={preferences.floatingToolbarVisibility} onChange={(event) => onChange({ ...preferences, floatingToolbarVisibility: event.target.value as FloatingToolbarVisibility })}>
              <option value="always">始终</option>
              <option value="hover">悬停时</option>
              <option value="never">从不</option>
            </select>
          </label>

          <div className="editor-preference-row">
            <span><strong>显示添加主题按钮</strong><small>选中主题时显示添加子节点和同级节点按钮。</small></span>
            <button type="button" className={`editor-preference-switch ${preferences.showAddTopicButtons ? 'is-on' : ''}`} role="switch" aria-checked={preferences.showAddTopicButtons} aria-label="显示添加主题按钮" onClick={() => onChange({ ...preferences, showAddTopicButtons: !preferences.showAddTopicButtons })}><span /></button>
          </div>
        </div>

        <footer className="editor-preferences-dialog__footer">
          <p><InfoCircledIcon aria-hidden="true" />设置保存在当前设备，并会立即应用到画布。</p>
          <button type="button" onClick={onClose}>完成</button>
        </footer>
      </section>
    </div>
  )
}
