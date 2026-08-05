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
import type { MindNodeAttachment, MindNodePriority, MindNodeTaskStatus, NodeMark } from '../domain/document.types'
import { nodeMarkMeta } from '../domain/node-semantics'
import { AttachmentImage } from '../attachments/AttachmentImage'
import { resolveSemanticNodeEmphasis, type SemanticZoomLevel } from './semantic-zoom'

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
  hiddenDescendantCount: number
  accentColor: string
  isRelationSource: boolean
  imageAttachment?: MindNodeAttachment | null
  /** 当前画布的信息密度；只影响内容显隐，不改变布局尺寸。 */
  semanticZoomLevel: SemanticZoomLevel
  /** 中心主题为 0；仅用于远景视觉权重，不参与节点尺寸与布局。 */
  depth: number
  /** 布局层分配给当前卡片的高度；编辑框以它为最低高度，避免进入编辑后裁掉原有多行内容。 */
  layoutHeight: number
  onEditingHeightChange?: (height: number | null) => void
}

export const MindNode = memo(function MindNode({ id, data, selected }: NodeProps) {
  const node = data as MindNodeData
  const editingNodeId = useEditorStore((state) => state.editingNodeId)
  const editingInitialText = useEditorStore((state) => state.editingNodeId === id ? state.editingInitialText : null)
  const editNode = useEditorStore((state) => state.editNode)
  const selectNode = useEditorStore((state) => state.selectNode)
  const dispatch = useEditorStore((state) => state.dispatch)
  const isEditing = editingNodeId === id
  // 非编辑节点不订阅整份文档，避免输入一个字导致画布上每个卡片都随之重渲染。
  const document = useEditorStore((state) => state.editingNodeId === id ? state.document : null)
  const [topic, setTopic] = useState(node.label)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const preparedEditRef = useRef<string | null>(null)
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
  const markerControlsRef = useRef<HTMLSpanElement>(null)
  const [markerMenu, setMarkerMenu] = useState<'task' | 'priority' | null>(null)

  useEffect(() => {
    if (!isEditing || editingInitialText === null) setTopic(node.label)
  }, [editingInitialText, isEditing, node.label])
  useEffect(() => {
    if (!markerMenu) return
    const closeMarkerMenu = (event: PointerEvent) => {
      if (!markerControlsRef.current?.contains(event.target as globalThis.Node)) setMarkerMenu(null)
    }
    globalThis.document.addEventListener('pointerdown', closeMarkerMenu, true)
    return () => globalThis.document.removeEventListener('pointerdown', closeMarkerMenu, true)
  }, [markerMenu])
  useLayoutEffect(() => {
    if (!isEditing) {
      preparedEditRef.current = null
      return
    }
    const editKey = `${id}:${editingInitialText ?? '__existing__'}`
    const initialTopic = editingInitialText ?? node.label
    if (preparedEditRef.current !== editKey && topic !== initialTopic) {
      setTopic(initialTopic)
      return
    }
    if (preparedEditRef.current === editKey) return
    preparedEditRef.current = editKey
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
  }, [editingInitialText, id, isEditing, node.label, topic])
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
      // 输入框只占文本本身的高度，由外层在节点内容区中垂直居中。
      // 不能让 textarea 撑满人工放大的节点，否则浏览态居中的单行文字会在双击后跳到顶部。
      const nextHeight = contentHeight
      input.style.height = `${nextHeight}px`
      setEditorHeight((current) => current === nextHeight ? current : nextHeight)

      // 多行文本或幽灵续写超过原卡片时再扩高；短文本进入编辑不能缩小已有卡片。
      const layoutHeight = Math.max(node.layoutHeight, nextHeight + 16)
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
  // 被选中或编辑的节点始终恢复完整工作能力，远景下仍可直接继续当前任务。
  const effectiveDetailLevel: SemanticZoomLevel = selected || isEditing ? 'workspace' : node.semanticZoomLevel
  const showWorkspaceDetails = effectiveDetailLevel === 'workspace'
  const showStructureSignals = effectiveDetailLevel === 'structure'
  const semanticEmphasis = resolveSemanticNodeEmphasis(effectiveDetailLevel, node.depth)
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
      className={`mind-node mind-node--detail-${effectiveDetailLevel} mind-node--emphasis-${semanticEmphasis} mind-node--depth-${Math.min(node.depth, 4)} ${node.isRoot ? 'mind-node--root' : ''} ${node.isFreeTopic ? 'mind-node--free-topic' : ''} ${node.isDropTarget ? 'is-drop-target' : ''} ${selected ? 'is-selected' : ''} ${node.isRelationSource ? 'is-relation-source' : ''}`}
      style={{ '--node-accent': node.accentColor } as CSSProperties}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onDoubleClick={beginEditing}
    >
      {!isEditing && showWorkspaceDetails && (selected || isHovering) && <NodeResizeControl
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
          className={`collapse-toggle ${node.collapsed ? 'is-collapsed' : ''}`}
          style={node.collapsed ? undefined : { right: '-13px' }}
          onClick={(event) => { event.stopPropagation(); dispatch({ type: 'TOGGLE_COLLAPSE', nodeId: id }) }}
          aria-label={node.collapsed ? `展开节点，包含 ${node.hiddenDescendantCount} 个隐藏分支` : '折叠节点'}
        >
          {node.collapsed ? node.hiddenDescendantCount : '−'}
        </button>
      )}
      {isEditing ? (
        <div className="node-input-shell" style={{ display: 'flex', alignItems: 'center', minHeight: `${Math.max(editorHeight ?? 0, node.layoutHeight - 16)}px` }}>
          {suggestion && <div ref={mirrorRef} className="node-input-mirror" aria-hidden="true"><span>{topic}</span><span className="node-input-mirror__suggestion">{suggestion}</span></div>}
          <textarea
            ref={inputRef}
            className={`node-input nodrag nowheel ${suggestion ? 'node-input--ghost' : ''}`}
            value={topic}
            rows={1}
            wrap="soft"
            style={{ height: `${editorHeight ?? 19}px` }}
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
                if (event.shiftKey) return
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
      ) : <div className={`node-label ${showWorkspaceDetails && node.imageAttachment ? 'has-image' : ''}`} title="双击编辑主题">
        {showStructureSignals && (taskIcon || node.priority > 0 || node.marks.length > 0 || node.tags.length > 0 || node.imageAttachment) && <span className="node-semantic-signals" aria-label="节点包含任务或资源信息">
          {taskIcon && <i>{taskIcon}</i>}
          {node.priority > 0 && <i>P{node.priority}</i>}
          {node.marks.length > 0 && <i>◆</i>}
          {node.tags.length > 0 && <i>●</i>}
          {node.imageAttachment && <i>▧</i>}
        </span>}
        {showWorkspaceDetails && (taskIcon || node.priority > 0 || node.marks.length > 0 || node.tags.length > 0) && <span ref={markerControlsRef} className="node-markers" title={[taskLabel, node.priority > 0 ? `优先级 ${node.priority}` : '', ...node.marks.map((mark) => nodeMarkMeta[mark].label), ...node.tags.map((tag) => tag.name)].filter(Boolean).join('，')}>
          {taskIcon && <button type="button" className={`node-task node-task--${node.taskStatus} nodrag`} aria-label={`任务状态：${taskLabel}，点击修改`} aria-haspopup="menu" aria-expanded={markerMenu === 'task'} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); selectNode(id); setMarkerMenu((current) => current === 'task' ? null : 'task') }}>{taskIcon}</button>}
          {markerMenu === 'task' && <span className="node-marker-menu nodrag" role="menu" aria-label="设置任务状态" onPointerDown={(event) => event.stopPropagation()}>{([['none', '普通主题'], ['todo', '待办'], ['doing', '进行中'], ['done', '已完成']] as Array<[MindNodeTaskStatus, string]>).map(([status, label]) => <button key={status} type="button" role="menuitem" className={node.taskStatus === status ? 'is-active' : ''} onClick={(event) => { event.stopPropagation(); dispatch({ type: 'SET_NODE_TASK_STATUS', nodeId: id, taskStatus: status }); setMarkerMenu(null) }}>{label}</button>)}</span>}
          {node.priority > 0 && <button type="button" className="node-priority nodrag" aria-label={`优先级 P${node.priority}，点击修改`} aria-haspopup="menu" aria-expanded={markerMenu === 'priority'} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); selectNode(id); setMarkerMenu((current) => current === 'priority' ? null : 'priority') }}>P{node.priority}</button>}
          {markerMenu === 'priority' && <span className="node-marker-menu nodrag" role="menu" aria-label="设置优先级" onPointerDown={(event) => event.stopPropagation()}>{([[0, '未设置'], [1, 'P1 · 高'], [2, 'P2 · 中'], [3, 'P3 · 低']] as Array<[MindNodePriority, string]>).map(([priority, label]) => <button key={priority} type="button" role="menuitem" className={node.priority === priority ? 'is-active' : ''} onClick={(event) => { event.stopPropagation(); dispatch({ type: 'SET_NODE_PRIORITY', nodeId: id, priority }); setMarkerMenu(null) }}>{label}</button>)}</span>}
          {node.marks.map((mark) => <i key={mark} className={`node-mark node-mark--${mark}`} title={nodeMarkMeta[mark].label} aria-hidden="true">{nodeMarkMeta[mark].icon}</i>)}
          {node.tags.map((tag) => <i key={tag.id} className="node-tag-dot" title={tag.name} style={{ '--tag-color': tag.color } as CSSProperties} aria-hidden="true" />)}
        </span>}
        <span>{node.label}</span>
        {showWorkspaceDetails && node.imageAttachment && <AttachmentImage attachment={node.imageAttachment} variant="node" />}
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
        // 原生贝塞尔树枝的起点外移 4px；展开按钮覆盖该交汇锚点，但不改变曲线路径。
        style={{ top: '50%', right: node.hasChildren ? '-4px' : undefined, transform: 'translate(50%, -50%)' }}
        isConnectable={false}
      />
      <Handle id="relation-source-left" type="source" position={Position.Left} className="node-handle node-handle--relation" style={{ top: '28%' }} isConnectable={false} />
      <Handle id="relation-source-right" type="source" position={Position.Right} className="node-handle node-handle--relation" style={{ top: '28%' }} isConnectable={false} />
    </div>
  )
})
