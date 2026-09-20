/**
 * AiCustomPrompt — 节点级 AI 自定义扩展输入层（Xmind On-demand 模式）。
 *
 * 从浮动工具条或右键菜单触发，锚定在目标节点下方；输入要求后按 Enter 生成。
 * Escape 或点击遮罩取消。
 */
import { useEffect, useRef, useState } from 'react'

type AiCustomPromptProps = {
  nodeTopic: string
  /** 视口坐标；为 null 时居中显示。 */
  anchor: { x: number; y: number } | null
  onSubmit: (prompt: string) => void
  onClose: () => void
}

export function AiCustomPrompt({ nodeTopic, anchor, onSubmit, onClose }: AiCustomPromptProps) {
  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const submit = () => {
    const value = prompt.trim()
    if (!value) return
    onSubmit(value)
  }

  const style = anchor
    ? { left: Math.max(12, Math.min(anchor.x - 130, window.innerWidth - 292)), top: Math.min(anchor.y, window.innerHeight - 120) }
    : { left: '50%', top: '30%', transform: 'translateX(-50%)' }

  return (
    <div className="ai-custom-prompt-layer" onMouseDown={onClose}>
      <div className="ai-custom-prompt" style={style} role="dialog" aria-label="自定义 AI 扩展" onMouseDown={(event) => event.stopPropagation()}>
        <p className="ai-custom-prompt__title">✏️ 扩展「{nodeTopic || '未命名节点'}」</p>
        <input
          ref={inputRef}
          value={prompt}
          placeholder="说说想怎么扩展，例如：按实施步骤展开"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') { event.preventDefault(); submit() }
          }}
        />
        <p className="ai-custom-prompt__hint">Enter 生成 · Esc 取消 · 结果直接上图，⌘Z 可撤销</p>
      </div>
    </div>
  )
}
