import { useEffect, useRef } from 'react'
import { Cross2Icon, InfoCircledIcon } from '@radix-ui/react-icons'
import type { MindMapDocument } from '../domain/document.types'
import type { EditorPreferences, FloatingToolbarVisibility } from './editor-preferences'

const toolbarDescriptions: Record<FloatingToolbarVisibility, string> = {
  always: '选中主题时立即显示浮动工具栏。',
  hover: '选中主题后，鼠标移入主题时显示工具栏。',
  never: '选中主题时不显示浮动工具栏。',
}

export function EditorPreferencesDialog({ open, preferences, onChange, onClose, layout, onLayoutChange }: {
  layout?: MindMapDocument['layout']
  onLayoutChange?: (layout: Partial<MindMapDocument['layout']>) => void
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
            <h2 id="editor-preferences-title">编辑器设置</h2>
            <p>调整编辑交互与当前导图的布局。</p>
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

        {layout && onLayoutChange && <section className="editor-layout-settings" aria-label="当前导图布局">
          <h3>当前导图布局</h3>
          <p>间距随当前导图保存，可通过撤销恢复。</p>
          <label htmlFor="settings-level-gap">层级间距 <output>{layout.levelGap}</output></label>
          <input id="settings-level-gap" type="range" min="48" max="180" value={layout.levelGap} onChange={(event) => onLayoutChange({ levelGap: Number(event.target.value) })} />
          <label htmlFor="settings-sibling-gap">同级间距 <output>{layout.siblingGap}</output></label>
          <input id="settings-sibling-gap" type="range" min="8" max="72" value={layout.siblingGap} onChange={(event) => onLayoutChange({ siblingGap: Number(event.target.value) })} />
        </section>}

        <footer className="editor-preferences-dialog__footer">
          <p><InfoCircledIcon aria-hidden="true" />修改立即应用。编辑偏好保存在当前设备，布局随导图保存。</p>
          <button type="button" onClick={onClose}>完成</button>
        </footer>
      </section>
    </div>
  )
}
