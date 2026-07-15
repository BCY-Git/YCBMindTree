/**
 * MindNode — 自定义 React Flow 节点渲染组件。
 *
 * 每个节点是一个带左边框高亮色的卡片，支持两种状态：
 * - 显示态（默认）：双击进入编辑态；子节点超过 0 个时显示折叠/展开按钮
 * - 编辑态：在输入框内直接修改主题文字，支持 AI 幽灵续写（Tab 接受）、Enter 提交、Escape 取消
 *
 * 树枝与关系线分别使用一组隐藏 Handle：树枝稳定连到卡片中线，
 * 关系线则从上侧区域出发，避免与折叠按钮和主树枝重叠。
 */
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Handle, NodeResizeControl, Position, type NodeProps } from '@xyflow/react'
import { useEditorStore } from '../store/editor.store'
import { isGhostCompletionEnabled, loadAiSettings } from '../ai/ai-settings'
import { requestGhostCompletion } from '../ai/ghost-completion'
import type { NodeMark } from '../domain/document.types'
import { nodeMarkMeta } from '../domain/node-semantics'

export type MindNodeData = {
  label: string
  isRoot: boolean
  isFreeTopic: boolean
  taskStatus: 'none' | 'todo' | 'doing' | 'done'
  priority: 0 | 1 | 2 | 3
  marks: NodeMark[]
  tags: Array<{ id: string; name: string; color: string }>
  isDropTarget: boolean
  hasChildren: boolean
  collapsed: boolean
  accentColor: string
  isRelationSource: boolean
  /** 布局层分配给当前卡片的高度；编辑框以它为最低高度，避免进入编辑后裁掉原有多行内容。 */
  layoutHeight: number
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
  const composingRef = useRef(false)
  const lastCompositionEndAtRef = useRef(0)
  const [isHovering, setIsHovering] = useState(false)
  const [editorHeight, setEditorHeight] = useState<number | null>(null)
  const reportedHeightRef = useRef<number | null>(null)

  useEffect(() => setTopic(node.label), [node.label])
  useLayoutEffect(() => {
    if (!isEditing) return
    let settleFrame = 0
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus({ preventScroll: true })
      input.setSelectionRange(input.value.length, input.value.length)
      // WebKit 有时会在 setSelectionRange 后异步把 textarea 卷到末尾；
      // 卡片已经为全文预留高度，因此保持从首行显示，不能让首尾几行被截掉。
      settleFrame = window.requestAnimationFrame(() => {
        input.scrollTop = 0
        input.scrollLeft = 0
      })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      window.cancelAnimationFrame(settleFrame)
    }
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
    const measure = () => {
      // 先解除已写入的高度，再读取真实排版后的 scrollHeight。不能按字符数猜测：
      // 缩放、CJK 字体和手动调整宽度都会使猜测与实际换行不一致。
      input.style.height = 'auto'
      const contentHeight = Math.max(
        19,
        Math.ceil(input.scrollHeight),
        Math.ceil(mirrorRef.current?.scrollHeight ?? 0),
      )
      // 展示态本来容得下的文本，在进入编辑态时必须仍然完整可见；
      // `layoutHeight` 已含节点边框与内边距，编辑区只取其中的内容空间。
      const minimumVisibleHeight = Math.max(19, node.layoutHeight - 16)
      const nextHeight = Math.max(contentHeight, minimumVisibleHeight)
      input.style.height = `${nextHeight}px`
      setEditorHeight((current) => current === nextHeight ? current : nextHeight)

      // 节点本体有 6px 内边距与边框；把编辑内容的实际高度交给画布临时布局，
      // 让同级节点随之平滑让位，而不是把幽灵文本裁在旧卡片高度内。
      const layoutHeight = nextHeight + 16
      if (reportedHeightRef.current !== layoutHeight) {
        reportedHeightRef.current = layoutHeight
        node.onEditingHeightChange?.(layoutHeight)
      }
    }
    measure()
    // 宽度只会在布局数据、输入文本或 AI 建议变化时改变，三者均是本 effect 的依赖。
    // 不监听自身尺寸：测量过程会写回 textarea 高度，监听自身会形成 ResizeObserver 循环。
  }, [isEditing, node.layoutHeight, node.onEditingHeightChange, suggestion, topic])
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
  const commit = (nextTopic = inputRef.current?.value ?? topic) => {
    if (nextTopic !== node.label) dispatch({ type: 'UPDATE_NODE_TOPIC', nodeId: id, topic: nextTopic })
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
  const beginEditing = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isEditing || (event.target as HTMLElement).closest('.collapse-toggle, .node-resize-control')) return
    event.preventDefault()
    event.stopPropagation()
    editNode(id)
  }
  const keepEditingGesture = (event: React.SyntheticEvent) => {
    // React Flow 会把节点上的普通指针手势解释为拖拽；编辑态必须把它留给 textarea，
    // 否则文字选择会变成拖图，且指针落下时可能触发 blur 导致中文输入被提前提交。
    event.stopPropagation()
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
      <Handle id="target-left" type="target" position={Position.Left} className="node-handle node-handle--target" style={{ top: '50%' }} isConnectable={false} />
      <Handle id="target-right" type="target" position={Position.Right} className="node-handle node-handle--target" style={{ top: '50%' }} isConnectable={false} />
      <Handle id="relation-target-left" type="target" position={Position.Left} className="node-handle node-handle--relation" style={{ top: '28%' }} isConnectable />
      <Handle id="relation-target-right" type="target" position={Position.Right} className="node-handle node-handle--relation" style={{ top: '28%' }} isConnectable />
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
        <div className="node-input-shell" style={{ minHeight: `${Math.max(editorHeight ?? 0, node.layoutHeight - 16)}px` }}>
          {suggestion && <div ref={mirrorRef} className="node-input-mirror" aria-hidden="true"><span>{topic}</span><span className="node-input-mirror__suggestion">{suggestion}</span></div>}
          <textarea
            ref={inputRef}
            className={`node-input nodrag nowheel ${suggestion ? 'node-input--ghost' : ''}`}
            value={topic}
            rows={1}
            wrap="soft"
            style={{ height: `${editorHeight ?? Math.max(19, node.layoutHeight - 16)}px` }}
            onPointerDown={keepEditingGesture}
            onMouseDown={keepEditingGesture}
            onDoubleClick={keepEditingGesture}
            onChange={(event) => { setCursorAtEnd(event.target.selectionStart === event.target.value.length); setTopic(event.target.value) }}
            onSelect={(event) => setCursorAtEnd(event.currentTarget.selectionStart === event.currentTarget.value.length && event.currentTarget.selectionEnd === event.currentTarget.value.length)}
            onCompositionStart={() => { composingRef.current = true; setComposing(true) }}
            onCompositionEnd={(event) => {
              composingRef.current = false
              // WebKit 对输入法确认的事件顺序并不稳定：compositionend 可能在 Enter 前或后。
              // 记录结束时间，在很短窗口内一律把 Enter 视为候选字确认，而不是编辑命令。
              lastCompositionEndAtRef.current = Date.now()
              setComposing(false)
              setTopic(event.currentTarget.value)
              setCursorAtEnd(event.currentTarget.selectionStart === event.currentTarget.value.length)
            }}
            onBlur={() => commit()}
            onKeyDown={(event) => {
              // 编辑框内的全选必须留在当前节点，不能冒泡给画布或浏览器页面。
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
                event.preventDefault()
                event.stopPropagation()
                event.currentTarget.select()
                setCursorAtEnd(false)
                return
              }
              // 中文、日文等输入法会用 Enter 确认候选字；组合期间不能提交节点或新建同级节点。
              if (event.nativeEvent.isComposing || composingRef.current || event.nativeEvent.keyCode === 229) return
              if (event.key === 'Escape') { event.preventDefault(); setSuggestion(''); setTopic(node.label); editNode(null); return }
              if (event.key === 'Tab') { event.preventDefault(); if (!acceptSuggestion()) commit(event.currentTarget.value); return }
              if (event.key === 'Enter') {
                event.preventDefault()
                if (Date.now() - lastCompositionEndAtRef.current < 160) return
                commit(event.currentTarget.value)
              }
            }}
          />
          {isCompleting && <span className="sr-only" role="status">AI 正在续写</span>}
          {suggestion && <span className="sr-only">按 Tab 接受 AI 续写，按 Esc 忽略</span>}
          {completionError && <span className="sr-only" role="status">AI 续写暂不可用</span>}
        </div>
      ) : <div className="node-label" title="双击编辑主题">
        {(taskIcon || node.priority > 0 || node.marks.length > 0 || node.tags.length > 0) && <span className="node-markers" aria-label={[taskLabel, node.priority > 0 ? `优先级 ${node.priority}` : '', ...node.marks.map((mark) => nodeMarkMeta[mark].label), ...node.tags.map((tag) => tag.name)].filter(Boolean).join('，')}>
          {taskIcon && <i className={`node-task node-task--${node.taskStatus}`} aria-hidden="true">{taskIcon}</i>}
          {node.priority > 0 && <i className="node-priority" aria-hidden="true">P{node.priority}</i>}
          {node.marks.map((mark) => <i key={mark} className={`node-mark node-mark--${mark}`} title={nodeMarkMeta[mark].label} aria-hidden="true">{nodeMarkMeta[mark].icon}</i>)}
          {node.tags.map((tag) => <i key={tag.id} className="node-tag-dot" title={tag.name} style={{ '--tag-color': tag.color } as CSSProperties} aria-hidden="true" />)}
        </span>}
        <span>{node.label}</span>
      </div>}
      <Handle
        id="source-left"
        type="source"
        position={Position.Left}
        className="node-handle node-handle--source"
        // 自定义的缩放动画不能覆盖 React Flow 的锚点位移，否则连线会缩进卡片内部。
        style={{ top: '50%', transform: 'translate(-50%, -50%)' }}
        isConnectable={false}
      />
      <Handle
        id="source-right"
        type="source"
        position={Position.Right}
        className="node-handle node-handle--source"
        // 折叠按钮半径为 9px；React Flow 默认使用 10px Handle 的外侧作为路径起点，
        // 已经超出卡片 5px，因此再外移 4px 即与按钮外缘精确重合。
        style={{ top: '50%', right: node.hasChildren ? '-4px' : undefined, transform: 'translate(50%, -50%)' }}
        isConnectable={false}
      />
      <Handle id="relation-source-left" type="source" position={Position.Left} className="node-handle node-handle--relation" style={{ top: '28%' }} isConnectable={false} />
      <Handle id="relation-source-right" type="source" position={Position.Right} className="node-handle node-handle--relation" style={{ top: '28%' }} isConnectable={false} />
    </div>
  )
})
