/**
 * CommandPalette — ⌘K 命令面板。
 *
 * 模糊搜索所有可用操作，按标签和描述匹配，显示快捷键提示。
 * 关闭方式：点击遮罩层、按 Escape 或执行任意操作后自动关闭。
 */
import { useEffect, useMemo, useRef, useState } from 'react'

type PaletteAction = {
  label: string
  detail: string
  shortcut: string
  disabled?: boolean
  run: () => void
}

type CommandPaletteProps = {
  onClose: () => void
  actions: PaletteAction[]
}

export function CommandPalette({ onClose, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => actions.filter((action) => `${action.label}${action.detail}`.includes(query.trim())), [actions, query])

  useEffect(() => {
    inputRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="command-palette-layer" role="dialog" aria-modal="true" aria-label="命令面板" onMouseDown={onClose}>
      <section className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette__search">
          <span aria-hidden="true">⌘</span>
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索命令…" />
          <kbd>Esc</kbd>
        </div>
        <div className="command-palette__list">
          {matches.length ? matches.map((action) => (
            <button key={action.label} disabled={action.disabled} onClick={() => { action.run(); onClose() }}>
              <span><strong>{action.label}</strong><small>{action.detail}</small></span>
              <kbd>{action.shortcut}</kbd>
            </button>
          )) : <p className="command-palette__empty">没有匹配的操作</p>}
        </div>
        <footer><span><kbd>⌘ K</kbd> 命令</span><span><kbd>Tab</kbd> 子节点</span><span><kbd>↵</kbd> 同级节点</span></footer>
      </section>
    </div>
  )
}
