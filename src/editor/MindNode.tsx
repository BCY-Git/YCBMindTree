/**
 * MindNode — 自定义 React Flow 节点渲染组件。
 *
 * 每个节点是一个带左边框高亮色的卡片，支持两种状态：
 * - 显示态（默认）：双击进入编辑态；子节点超过 0 个时显示折叠/展开按钮
 * - 编辑态：在输入框内直接修改主题文字，支持 AI 幽灵续写（Tab 接受）、Enter 创建同级、Escape 取消
 *
 * 左侧有 4 个隐藏的 Handle（source-left/right, target-left/right），
 * 由 tree-edge.ts 根据节点相对位置决定哪两个实际连接画布边。
 */
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Handle, NodeResizeControl, Position, type NodeProps } from '@xyflow/react'
import { useEditorStore } from '../store/editor.store'
import { isGhostCompletionEnabled, loadAiSettings } from '../ai/ai-settings'
import { requestGhostCompletion } from '../ai/ghost-completion'

export type MindNodeData = {
  label: string
  isRoot: boolean
  isFreeTopic: boolean
  taskStatus: 'none' | 'todo' | 'doing' | 'done'
  priority: 0 | 1 | 2 | 3
  isDropTarget: boolean
  hasChildren: boolean
  collapsed: boolean
  accentColor: string
  isRelationSource: boolean
  onEditingHeightChange?: (height: number | null) => void
}

export const MindNode = memo(function MindNode({ id, data, selected }: NodeProps) {
  const node = data as MindNodeData
  const editingNodeId = useEditorStore((state) => state.editingNodeId)
  const editNode = useEditorStore((state) => state.editNode)
  const dispatch = useEditorStore((state) => state.dispatch)
  const isEditing = editingNodeId === id
  // 非编辑节点不订阅整份文档，避免输入一个字导致画布上每个卡片都随之重渲染。
  const document = useEditorStore((state) => state.editingNodeId === id ? state.document : null)
  const [topic, setTopic] = useState(node.label)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const [suggestion, setSuggestion] = useState('')
  const [isCompleting, setIsCompleting] = useState(false)
  const [completionError, setCompletionError] = useState(false)
  const [cursorAtEnd, setCursorAtEnd] = useState(true)
  const [composing, setComposing] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const [editorHeight, setEditorHeight] = useState<number | null>(null)
  const reportedHeightRef = useRef<number | null>(null)

  useEffect(() => setTopic(node.label), [node.label])
  useLayoutEffect(() => {
    if (!isEditing) return
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus({ preventScroll: true })
      input.setSelectionRange(input.value.length, input.value.length)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isEditing])
  useLayoutEffect(() => {
    if (!isEditing) {
      setEditorHeight(null)
      if (reportedHeightRef.current !== null) {
        reportedHeightRef.current = null
        node.onEditingHeightChange?.(null)
      }
      return
    }
    const input = inputRef.current
    if (!input) return
    input.style.height = '0px'
    const nextHeight = Math.max(19, Math.ceil(input.scrollHeight), Math.ceil(mirrorRef.current?.scrollHeight ?? 0))
    input.style.height = ''
    setEditorHeight((current) => current === nextHeight ? current : nextHeight)
    // 节点本体有 6px 内边距与边框；把编辑内容的实际高度交给画布临时布局，
    // 让同级节点随之平滑让位，而不是把幽灵文本裁在旧卡片高度内。
    const layoutHeight = nextHeight + 16
    // Canvas 会因临时高度重新计算 node data；不能每次重新渲染都再回报相同高度，
    // 否则编辑态会在 React Flow 与画布布局之间形成无限更新循环。
    if (reportedHeightRef.current !== layoutHeight) {
      reportedHeightRef.current = layoutHeight
      node.onEditingHeightChange?.(layoutHeight)
    }
  }, [isEditing, node.onEditingHeightChange, suggestion, topic])
  useEffect(() => {
    requestRef.current?.abort()
    setSuggestion('')
    setIsCompleting(false)
    setCompletionError(false)
    const settings = loadAiSettings()
    if (!isEditing || !document || composing || !cursorAtEnd || !isGhostCompletionEnabled() || topic.trim().length < 3 || !settings.endpoint.trim() || !settings.model.trim() || (!settings.apiKey.trim() && !import.meta.env.DEV)) return
    const controller = new AbortController()
    requestRef.current = controller
    const timer = window.setTimeout(() => {
      setIsCompleting(true)
      void requestGhostCompletion(settings, document, id, topic, controller.signal, 24)
        .then((completion) => { if (!controller.signal.aborted) setSuggestion(completion) })
        .catch(() => { if (!controller.signal.aborted) setCompletionError(true) })
        .finally(() => { if (!controller.signal.aborted) setIsCompleting(false) })
    }, 650)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [composing, cursorAtEnd, document, id, isEditing, topic])

  // 提交编辑：仅当内容实际变化时才派发 UPDATE_NODE_TOPIC 命令，然后退出编辑态。
  const commit = () => {
    if (topic !== node.label) dispatch({ type: 'UPDATE_NODE_TOPIC', nodeId: id, topic })
    editNode(null)
  }
  const acceptSuggestion = () => {
    if (!suggestion) return false
    setTopic(`${topic}${suggestion}`)
    setSuggestion('')
    return true
  }
  const taskIcon = node.taskStatus === 'todo' ? '○' : node.taskStatus === 'doing' ? '◐' : node.taskStatus === 'done' ? '✓' : null
  const taskLabel = node.taskStatus === 'todo' ? '待办' : node.taskStatus === 'doing' ? '进行中' : node.taskStatus === 'done' ? '已完成' : ''
  // 保留原有换行，并按节点宽度估算自动换行，编辑态不能把长标题压回单行。
  const charactersPerLine = node.isRoot ? 20 : 16
  const editorLineCount = Math.max(1, (topic + suggestion).split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0))
  const beginEditing = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isEditing || (event.target as HTMLElement).closest('.collapse-toggle, .node-resize-control')) return
    event.preventDefault()
    event.stopPropagation()
    editNode(id)
  }

  return (
    <div
      className={`mind-node ${node.isRoot ? 'mind-node--root' : ''} ${node.isFreeTopic ? 'mind-node--free-topic' : ''} ${node.isDropTarget ? 'is-drop-target' : ''} ${selected ? 'is-selected' : ''} ${node.isRelationSource ? 'is-relation-source' : ''}`}
      style={{ '--node-accent': node.accentColor } as CSSProperties}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onDoubleClick={beginEditing}
    >
      {!isEditing && (selected || isHovering) && <NodeResizeControl
        position="bottom-right"
        className="node-resize-control"
        minWidth={node.isRoot ? 196 : 118}
        minHeight={node.isRoot ? 58 : 44}
        maxWidth={560}
        maxHeight={420}
        autoScale
        onResizeEnd={(_, size) => dispatch({ type: 'SET_NODE_SIZE', nodeId: id, width: size.width, height: size.height })}
      />}
      <Handle id="target-left" type="target" position={Position.Left} className="node-handle" />
      <Handle id="target-right" type="target" position={Position.Right} className="node-handle" />
      {node.hasChildren && (
        <button
          className="collapse-toggle"
          onClick={(event) => { event.stopPropagation(); dispatch({ type: 'TOGGLE_COLLAPSE', nodeId: id }) }}
          aria-label={node.collapsed ? '展开节点' : '折叠节点'}
        >
          {node.collapsed ? '+' : '−'}
        </button>
      )}
      {isEditing ? (
        <div className="node-input-shell" style={{ minHeight: `${Math.max(editorHeight ?? 0, editorLineCount * 19)}px` }}>
          {suggestion && <div ref={mirrorRef} className="node-input-mirror" aria-hidden="true"><span>{topic}</span><span className="node-input-mirror__suggestion">{suggestion}</span></div>}
          <textarea
            ref={inputRef}
            className={`node-input ${suggestion ? 'node-input--ghost' : ''}`}
            value={topic}
            rows={1}
            style={{ height: `${editorHeight ?? editorLineCount * 19}px` }}
            onChange={(event) => { setCursorAtEnd(event.target.selectionStart === event.target.value.length); setTopic(event.target.value) }}
            onSelect={(event) => setCursorAtEnd(event.currentTarget.selectionStart === event.currentTarget.value.length && event.currentTarget.selectionEnd === event.currentTarget.value.length)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => { setComposing(false); setTopic(event.currentTarget.value); setCursorAtEnd(event.currentTarget.selectionStart === event.currentTarget.value.length) }}
            onBlur={commit}
            onKeyDown={(event) => {
              // 中文、日文等输入法会用 Enter 确认候选字；组合期间不能提交节点或新建同级节点。
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
              if (event.key === 'Escape') { setSuggestion(''); setTopic(node.label); editNode(null) }
              if (event.key === 'Tab') { event.preventDefault(); if (!acceptSuggestion()) commit() }
              if (event.key === 'Enter') { event.preventDefault(); commit(); dispatch({ type: 'ADD_SIBLING', nodeId: id }) }
            }}
          />
          {isCompleting && <span className="sr-only" role="status">AI 正在续写</span>}
          {suggestion && <span className="sr-only">按 Tab 接受 AI 续写，按 Esc 忽略</span>}
          {completionError && <span className="sr-only" role="status">AI 续写暂不可用</span>}
        </div>
      ) : <div className="node-label" title="双击编辑主题">
        {(taskIcon || node.priority > 0) && <span className="node-markers" aria-label={[taskLabel, node.priority > 0 ? `优先级 ${node.priority}` : ''].filter(Boolean).join('，')}>
          {taskIcon && <i className={`node-task node-task--${node.taskStatus}`} aria-hidden="true">{taskIcon}</i>}
          {node.priority > 0 && <i className="node-priority" aria-hidden="true">P{node.priority}</i>}
        </span>}
        <span>{node.label}</span>
      </div>}
      <Handle id="source-left" type="source" position={Position.Left} className="node-handle" />
      <Handle id="source-right" type="source" position={Position.Right} className="node-handle" />
    </div>
  )
})
