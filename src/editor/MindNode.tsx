/**
 * MindNode — 自定义 React Flow 节点渲染组件。
 *
 * 每个节点是一个带左边框高亮色的卡片，支持两种状态：
 * - 显示态（默认）：双击进入编辑态；子节点超过 0 个时显示折叠/展开按钮
 * - 编辑态：在输入框内直接修改主题文字，支持 Enter/Tab/Escape 提交或取消
 *
 * 左侧有 4 个隐藏的 Handle（source-left/right, target-left/right），
 * 由 tree-edge.ts 根据节点相对位置决定哪两个实际连接画布边。
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useEditorStore } from '../store/editor.store'

export type MindNodeData = {
  label: string
  isRoot: boolean
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
  const isEditing = editingNodeId === id
  const [topic, setTopic] = useState(node.label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setTopic(node.label), [node.label])
  useEffect(() => { if (isEditing) inputRef.current?.focus() }, [isEditing])

  // 提交编辑：仅当内容实际变化时才派发 UPDATE_NODE_TOPIC 命令，然后退出编辑态。
  const commit = () => {
    if (topic !== node.label) dispatch({ type: 'UPDATE_NODE_TOPIC', nodeId: id, topic })
    editNode(null)
  }

  return (
    <div className={`mind-node ${node.isRoot ? 'mind-node--root' : ''} ${selected ? 'is-selected' : ''} ${node.isRelationSource ? 'is-relation-source' : ''}`} style={{ '--node-accent': node.accentColor } as CSSProperties}>
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
        <input
          ref={inputRef}
          className="node-input"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { setTopic(node.label); editNode(null) }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              commit()
              if (event.key === 'Tab') dispatch({ type: 'ADD_CHILD', parentId: id })
              else dispatch({ type: 'ADD_SIBLING', nodeId: id })
            }
          }}
        />
      ) : (
        <button className="node-label" onDoubleClick={() => editNode(id)}>{node.label}</button>
      )}
      <Handle id="source-left" type="source" position={Position.Left} className="node-handle" />
      <Handle id="source-right" type="source" position={Position.Right} className="node-handle" />
    </div>
  )
}
