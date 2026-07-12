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
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
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
}

export function MindNode({ id, data, selected }: NodeProps) {
  const node = data as MindNodeData
  const editingNodeId = useEditorStore((state) => state.editingNodeId)
  const editNode = useEditorStore((state) => state.editNode)
  const dispatch = useEditorStore((state) => state.dispatch)
  const document = useEditorStore((state) => state.document)
  const isEditing = editingNodeId === id
  const [topic, setTopic] = useState(node.label)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const [suggestion, setSuggestion] = useState('')
  const [isCompleting, setIsCompleting] = useState(false)
  const [cursorAtEnd, setCursorAtEnd] = useState(true)
  const [composing, setComposing] = useState(false)

  useEffect(() => setTopic(node.label), [node.label])
  useEffect(() => { if (isEditing) inputRef.current?.focus() }, [isEditing])
  useEffect(() => {
    requestRef.current?.abort()
    setSuggestion('')
    setIsCompleting(false)
    const settings = loadAiSettings()
    if (!isEditing || composing || !cursorAtEnd || !isGhostCompletionEnabled() || topic.trim().length < 3 || !settings.endpoint.trim() || !settings.model.trim() || (!settings.apiKey.trim() && !import.meta.env.DEV)) return
    const controller = new AbortController()
    requestRef.current = controller
    const timer = window.setTimeout(() => {
      setIsCompleting(true)
      void requestGhostCompletion(settings, document, id, topic, controller.signal, 24)
        .then((completion) => { if (!controller.signal.aborted) setSuggestion(completion) })
        .catch(() => undefined)
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

  return (
    <div className={`mind-node ${node.isRoot ? 'mind-node--root' : ''} ${node.isFreeTopic ? 'mind-node--free-topic' : ''} ${node.isDropTarget ? 'is-drop-target' : ''} ${selected ? 'is-selected' : ''} ${node.isRelationSource ? 'is-relation-source' : ''}`} style={{ '--node-accent': node.accentColor } as CSSProperties}>
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
        <div className="node-input-shell">
          <input
            ref={inputRef}
            className="node-input"
            value={topic}
            onChange={(event) => { setCursorAtEnd(event.target.selectionStart === event.target.value.length); setTopic(event.target.value) }}
            onSelect={(event) => setCursorAtEnd(event.currentTarget.selectionStart === event.currentTarget.value.length && event.currentTarget.selectionEnd === event.currentTarget.value.length)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => { setComposing(false); setCursorAtEnd(event.currentTarget.selectionStart === event.currentTarget.value.length) }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { setSuggestion(''); setTopic(node.label); editNode(null) }
              if (event.key === 'Tab') { event.preventDefault(); if (!acceptSuggestion()) commit() }
              if (event.key === 'Enter') { event.preventDefault(); commit(); dispatch({ type: 'ADD_SIBLING', nodeId: id }) }
            }}
          />
          {isCompleting && <span className="node-completion-loading" aria-label="AI 正在续写">AI 续写中</span>}
          {suggestion && <span className="node-ghost-preview" aria-label="AI 续写建议"><strong>{suggestion}</strong><small>Tab 接受 · Esc 忽略</small></span>}
        </div>
      ) : <button className="node-label" title="双击编辑主题" onDoubleClick={() => editNode(id)}>
        {(taskIcon || node.priority > 0) && <span className="node-markers" aria-label={[taskLabel, node.priority > 0 ? `优先级 ${node.priority}` : ''].filter(Boolean).join('，')}>
          {taskIcon && <i className={`node-task node-task--${node.taskStatus}`} aria-hidden="true">{taskIcon}</i>}
          {node.priority > 0 && <i className="node-priority" aria-hidden="true">P{node.priority}</i>}
        </span>}
        <span>{node.label}</span>
      </button>}
      <Handle id="source-left" type="source" position={Position.Left} className="node-handle" />
      <Handle id="source-right" type="source" position={Position.Right} className="node-handle" />
    </div>
  )
}
