/**
 * MindMapCanvas — 思维导图画布主视图。
 *
 * 整合了 @xyflow/react 画布、键盘事件路由、右键菜单和命令面板。
 *
 * 职责：
 * - 根据 document + layout 生成 nodes / edges，交给 React Flow 渲染
 * - 监听键盘快捷键（Tab/Enter/Space/Delete/方向键等），派发对应命令
 * - 处理节点拖拽：普通拖拽更新偏移量，Shift+拖拽触发结构移动，
 *   根节点拖拽平移整张导图
 * - 管理右键菜单（ContextMenu）和命令面板（CommandPalette）的开关
 *
 * 所有命令通过 dispatch() 派发，状态更新由 editor.store 管理。
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  Background,
  ControlButton,
  Controls,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodePositionChange,
  type OnNodeDrag,
  type OnNodesChange,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from '@xyflow/react'
import { layoutTree } from '../layout/tree-layout'
import { useEditorStore } from '../store/editor.store'
import { MindNode, type MindNodeData } from './MindNode'
import { ContextMenu, type ContextMenuPosition } from './ContextMenu'
import { CommandPalette } from './CommandPalette'
import { getTheme } from '../domain/themes'
import { getTreeEdgeAnchors } from './tree-edge'

const nodeTypes = { mindNode: MindNode }

/**
 * 根据方向返回相邻节点 id。
 * 用于方向键导航：左键回到父节点，右键进入第一个子节点，上下键在同级节点间移动。
 */
function adjacentNodeId(nodeId: string, direction: string) {
  const { document } = useEditorStore.getState()
  const node = document.nodes[nodeId]
  if (!node) return null
  if (direction === 'ArrowLeft') return node.parentId
  if (direction === 'ArrowRight') return node.collapsed ? null : node.childIds[0] ?? null
  if (direction === 'ArrowUp' || direction === 'ArrowDown') {
    if (!node.parentId) return node.childIds[0] ?? null
    const siblings = document.nodes[node.parentId].childIds
    const index = siblings.indexOf(nodeId)
    return siblings[index + (direction === 'ArrowUp' ? -1 : 1)] ?? null
  }
  return null
}

export function MindMapCanvas() {
  const document = useEditorStore((state) => state.document)
  const theme = getTheme(document.theme.id)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectedRelationId = useEditorStore((state) => state.selectedRelationId)
  const editingNodeId = useEditorStore((state) => state.editingNodeId)
  const selectNode = useEditorStore((state) => state.selectNode)
  const selectRelation = useEditorStore((state) => state.selectRelation)
  const editNode = useEditorStore((state) => state.editNode)
  const dispatch = useEditorStore((state) => state.dispatch)
  const copyNode = useEditorStore((state) => state.copyNode)
  const cutNode = useEditorStore((state) => state.cutNode)
  const pasteIntoNode = useEditorStore((state) => state.pasteIntoNode)
  const clipboard = useEditorStore((state) => state.clipboard)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const [contextMenu, setContextMenu] = useState<{ position: ContextMenuPosition; nodeId: string | null; relationId: string | null } | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [relationSourceId, setRelationSourceId] = useState<string | null>(null)
  const [flowNodes, setFlowNodes] = useState<Node<MindNodeData>[]>([])
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node<MindNodeData>, Edge> | null>(null)

  // ── 构建 React Flow nodes / edges（响应 document / selectedNodeId / theme 变化）─────────
  const { baseNodes, edges, basePositionsById } = useMemo(() => {
    const placed = layoutTree(document)
    const visibleIds = new Set(placed.map((item) => item.id))
    const positionedById = new Map(placed.map((item) => [item.id, item]))
    const depthOf = (nodeId: string) => {
      let depth = 0
      let current = document.nodes[nodeId]
      while (current.parentId) { depth += 1; current = document.nodes[current.parentId] }
      return depth
    }
    const baseNodes: Node<MindNodeData>[] = placed.map((item) => {
      const mindNode = document.nodes[item.id]
      const depth = depthOf(item.id)
      return {
        id: item.id,
        type: 'mindNode',
        position: { x: item.x, y: item.y },
        selected: selectedNodeId === item.id,
        draggable: true,
        data: {
          label: mindNode.topic,
          isRoot: item.id === document.rootId,
          hasChildren: mindNode.childIds.length > 0,
          collapsed: mindNode.collapsed,
          accentColor: theme.palette[Math.max(0, depth - 1) % theme.palette.length],
          isRelationSource: relationSourceId === item.id,
        },
        style: { width: item.width, minHeight: item.height },
      }
    })
    const treeEdges: Edge[] = placed.flatMap((item) => {
      const mindNode = document.nodes[item.id]
      const parent = mindNode.parentId ? positionedById.get(mindNode.parentId) : undefined
      const anchors = parent ? getTreeEdgeAnchors(parent, item) : undefined
      return mindNode.parentId && visibleIds.has(mindNode.parentId)
        ? [{
            id: `${mindNode.parentId}-${item.id}`,
            source: mindNode.parentId,
            target: item.id,
            sourceHandle: anchors?.sourceHandle,
            targetHandle: anchors?.targetHandle,
            type: 'default',
            style: {
              stroke: theme.palette[Math.max(0, depthOf(item.id) - 1) % theme.palette.length] ?? theme.branch,
              strokeWidth: 2,
              opacity: 1,
            },
          }]
        : []
    })
    const relationEdges: Edge[] = document.relations.flatMap((relation) => {
      const source = positionedById.get(relation.sourceId)
      const target = positionedById.get(relation.targetId)
      if (!source || !target) return []
      const targetIsRight = target.x + target.width / 2 >= source.x + source.width / 2
      const isSelected = relation.id === selectedRelationId
      return [{
        id: relation.id,
        source: relation.sourceId,
        target: relation.targetId,
        sourceHandle: targetIsRight ? 'source-right' : 'source-left',
        targetHandle: targetIsRight ? 'target-left' : 'target-right',
        type: 'smoothstep',
        label: relation.label,
        className: `mind-relation-edge ${isSelected ? 'is-selected' : ''}`,
        selectable: true,
        style: { stroke: isSelected ? theme.selected : theme.branch, strokeWidth: isSelected ? 2.4 : 1.5, strokeDasharray: '7 5', opacity: isSelected ? 1 : .82 },
        labelStyle: { fill: theme.nodeText, fontSize: 11, fontWeight: 620 },
        labelBgStyle: { fill: theme.nodeBackground, fillOpacity: .94 },
        labelBgPadding: [5, 3] as [number, number],
        labelBgBorderRadius: 4,
        zIndex: 2,
      }]
    })
    return { baseNodes, edges: [...treeEdges, ...relationEdges], basePositionsById: new Map(placed.map((item) => [item.id, item])) }
  }, [document, relationSourceId, selectedNodeId, selectedRelationId, theme])

  useEffect(() => setFlowNodes(baseNodes), [baseNodes])

  const focusRoot = useCallback(() => {
    const rootNode = baseNodes.find((node) => node.id === document.rootId)
    selectNode(document.rootId)
    if (rootNode) flowInstance?.fitView({ nodes: [rootNode], padding: 1.5, maxZoom: 1.05, duration: 280 })
  }, [baseNodes, document.rootId, flowInstance, selectNode])

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    if (relationSourceId) {
      if (node.id !== relationSourceId && dispatch({ type: 'CREATE_RELATION', sourceId: relationSourceId, targetId: node.id })) setRelationSourceId(null)
      return
    }
    selectNode(node.id)
  }, [dispatch, relationSourceId, selectNode])
  // ── React Flow 节点拖拽结束：计算相对于自动布局基准位置的偏移量 ──────────────
  const getDragOffset = useCallback((node: Node<MindNodeData>) => {
    const original = basePositionsById.get(node.id)
    if (!original) return null
    return { x: node.position.x - original.x, y: node.position.y - original.y }
  }, [basePositionsById])
  // onNodesChange：处理 React Flow 内置的位置变化（批量移动、缩放等）。
  // 特殊处理：若根节点位置变化，将该偏移量同步到所有节点，实现"拖根平移全图"效果。
  const onNodesChange: OnNodesChange<Node<MindNodeData>> = useCallback((changes) => {
    setFlowNodes((current) => {
      const rootMove = changes.find((change): change is NodePositionChange => (
        change.type === 'position' && change.id === document.rootId && change.position !== undefined
      ))
      if (!rootMove?.position) return applyNodeChanges(changes, current)

      const root = current.find((node) => node.id === document.rootId)
      if (!root) return applyNodeChanges(changes, current)
      const deltaX = rootMove.position.x - root.position.x
      const deltaY = rootMove.position.y - root.position.y
      const nextNodes = applyNodeChanges(changes, current)
      return nextNodes.map((node) => node.id === document.rootId
        ? node
        : { ...node, position: { x: node.position.x + deltaX, y: node.position.y + deltaY } })
    })
  }, [document.rootId])
  // onNodeDragStop：判断当前拖拽类型，分发对应命令。
  // - 根节点 → TRANSLATE_DOCUMENT（平移全图）
  // - Shift+拖拽 → MOVE_NODE（结构调整）
  // - 普通拖拽 → UPDATE_NODE_OFFSET（自由偏移微调）
  const onNodeDragStop: OnNodeDrag<Node<MindNodeData>> = useCallback((_, node) => {
    const offset = getDragOffset(node)
    if (node.id === document.rootId) {
      if (!offset) return
      dispatch({ type: 'TRANSLATE_DOCUMENT', deltaX: offset.x, deltaY: offset.y })
      return
    }
    const isStructureDrag = 'shiftKey' in _ && _.shiftKey
    if (isStructureDrag) {
      const sizeOf = (candidate: Node<MindNodeData>) => ({
        width: Number(candidate.style?.width ?? candidate.measured?.width ?? 160),
        height: Number(candidate.style?.minHeight ?? candidate.measured?.height ?? 44),
      })
      const draggedSize = sizeOf(node)
      const draggedCenter = { x: node.position.x + draggedSize.width / 2, y: node.position.y + draggedSize.height / 2 }
      const target = flowNodes.find((candidate) => {
        if (candidate.id === node.id) return false
        const size = sizeOf(candidate)
        return draggedCenter.x >= candidate.position.x && draggedCenter.x <= candidate.position.x + size.width
          && draggedCenter.y >= candidate.position.y && draggedCenter.y <= candidate.position.y + size.height
      })
      const moved = target
        ? dispatch({ type: 'MOVE_NODE', nodeId: node.id, newParentId: target.id, index: document.nodes[target.id].childIds.length })
        : false
      if (!moved) setFlowNodes(baseNodes)
      return
    }
    const mindNode = document.nodes[node.id]
    if (!offset || !mindNode) return
    const moved = dispatch({
      type: 'UPDATE_NODE_OFFSET',
      nodeId: node.id,
      offsetX: mindNode.offsetX + offset.x,
      offsetY: mindNode.offsetY + offset.y,
    })
    if (!moved) setFlowNodes(baseNodes)
  }, [baseNodes, dispatch, document.nodes, flowNodes, getDragOffset])
  // ── 右键菜单：画布空白处打开画布菜单，节点上打开节点菜单 ───────────────────────
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const openContextMenu = useCallback((event: MouseEvent, nodeId: string | null) => {
    event.preventDefault()
    if (nodeId) selectNode(nodeId)
    setContextMenu({ position: { x: event.clientX, y: event.clientY }, nodeId, relationId: null })
  }, [selectNode])

  const runContextAction = useCallback((action: () => void) => {
    action()
    closeContextMenu()
  }, [closeContextMenu])

  // ── 全局键盘快捷键路由 ───────────────────────────────────────────────────────
  // 拦截所有键盘事件（在画布未聚焦时也能响应），转换为命令派发。
  // 注意：输入框/文本框内输入时跳过，避免干扰正常文字编辑。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const meta = event.metaKey || event.ctrlKey
      if (relationSourceId && event.key === 'Escape') { event.preventDefault(); setRelationSourceId(null); return }
      if (meta && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandPaletteOpen(true); return }
      if (target.closest('input, textarea')) return
      const editor = useEditorStore.getState()
      const selected = editor.selectedNodeId ?? editor.document.rootId
      if (editingNodeId || commandPaletteOpen) return
      if (meta && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if (meta && event.key.toLowerCase() === 'c') { event.preventDefault(); copyNode(selected); return }
      if (meta && event.key.toLowerCase() === 'x') { event.preventDefault(); cutNode(selected); return }
      if (meta && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteIntoNode(selected); return }
      if (event.key === 'Enter') { event.preventDefault(); dispatch({ type: 'ADD_SIBLING', nodeId: selected }); return }
      if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); dispatch({ type: 'OUTDENT_NODE', nodeId: selected }); return }
      if (event.key === 'Tab') { event.preventDefault(); dispatch({ type: 'ADD_CHILD', parentId: selected }); return }
      if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); dispatch({ type: 'INDENT_NODE', nodeId: selected }); return }
      if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); dispatch({ type: 'OUTDENT_NODE', nodeId: selected }); return }
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const current = useEditorStore.getState().document.nodes[selected]
        if (current?.parentId) {
          const siblings = useEditorStore.getState().document.nodes[current.parentId].childIds
          const index = siblings.indexOf(current.id)
          const nextIndex = index + (event.key === 'ArrowUp' ? -1 : 1)
          if (nextIndex >= 0 && nextIndex < siblings.length) {
            event.preventDefault()
            dispatch({ type: 'MOVE_NODE', nodeId: current.id, newParentId: current.parentId, index: nextIndex })
          }
        }
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); dispatch({ type: 'DELETE_NODE', nodeId: selected }); return }
      if (event.key === ' ') { event.preventDefault(); dispatch({ type: 'TOGGLE_COLLAPSE', nodeId: selected }); return }
      if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        const adjacent = adjacentNodeId(selected, event.key)
        if (adjacent) selectNode(adjacent)
        return
      }
      if (event.key === 'F2') editNode(selected)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandPaletteOpen, copyNode, cutNode, dispatch, editNode, editingNodeId, pasteIntoNode, redo, relationSourceId, selectNode, undo])

  return (
    <div className="canvas-shell" style={{
      '--canvas': theme.canvas,
      '--grid': theme.grid,
      '--node-bg': theme.nodeBackground,
      '--node-text': theme.nodeText,
      '--node-border': theme.nodeBorder,
      '--root-bg': theme.rootBackground,
      '--root-text': theme.rootText,
      '--selected': theme.selected,
    } as CSSProperties}>
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onInit={setFlowInstance}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={(_, node) => editNode(node.id)}
        onNodeContextMenu={(event, node) => openContextMenu(event.nativeEvent, node.id)}
        onPaneContextMenu={(event) => openContextMenu('nativeEvent' in event ? event.nativeEvent : event, null)}
        onEdgeClick={(event, edge) => { event.stopPropagation(); selectRelation(edge.id) }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault()
          selectRelation(edge.id)
          setContextMenu({ position: { x: event.clientX, y: event.clientY }, nodeId: null, relationId: edge.id })
        }}
        onPaneClick={() => { setRelationSourceId(null); selectNode(null); closeContextMenu() }}
        fitView
        minZoom={0.25}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color={theme.grid} />
        <Controls showInteractive={false}><ControlButton onClick={focusRoot} title="前往中心主题">◎</ControlButton></Controls>
      </ReactFlow>
      {relationSourceId && <div className="relation-creation-hint" role="status"><strong>正在创建关系</strong><span>请选择另一个节点作为目标 · Esc 取消</span></div>}
      {contextMenu && (() => {
        const contextNode = contextMenu.nodeId ? document.nodes[contextMenu.nodeId] : null
        const contextRelation = contextMenu.relationId ? document.relations.find((relation) => relation.id === contextMenu.relationId) ?? null : null
        const targetNodeId = contextNode?.id ?? document.rootId
        return (
          <ContextMenu
            position={contextMenu.position}
            node={contextNode}
            relation={contextRelation}
            isRoot={targetNodeId === document.rootId}
            onAddChild={() => runContextAction(() => dispatch({ type: 'ADD_CHILD', parentId: targetNodeId }))}
            onAddSibling={() => runContextAction(() => dispatch({ type: 'ADD_SIBLING', nodeId: targetNodeId }))}
            onEdit={() => runContextAction(() => editNode(targetNodeId))}
            onCreateRelation={() => runContextAction(() => { selectNode(targetNodeId); setRelationSourceId(targetNodeId) })}
            onToggleCollapse={() => runContextAction(() => dispatch({ type: 'TOGGLE_COLLAPSE', nodeId: targetNodeId }))}
            onCollapseDescendants={() => runContextAction(() => dispatch({ type: 'COLLAPSE_DESCENDANTS', nodeId: targetNodeId }))}
            onExpandDescendants={() => runContextAction(() => dispatch({ type: 'EXPAND_DESCENDANTS', nodeId: targetNodeId }))}
            onFocusRoot={() => runContextAction(focusRoot)}
            onIndent={() => runContextAction(() => dispatch({ type: 'INDENT_NODE', nodeId: targetNodeId }))}
            onOutdent={() => runContextAction(() => dispatch({ type: 'OUTDENT_NODE', nodeId: targetNodeId }))}
            onCopy={() => runContextAction(() => copyNode(targetNodeId))}
            onCut={() => runContextAction(() => cutNode(targetNodeId))}
            onPaste={() => runContextAction(() => pasteIntoNode(targetNodeId))}
            onResetPosition={() => runContextAction(() => dispatch({ type: 'RESET_NODE_OFFSET', nodeId: targetNodeId }))}
            onAutoArrange={() => runContextAction(() => dispatch({ type: 'AUTO_ARRANGE' }))}
            onRestoreFreeform={() => runContextAction(() => dispatch({ type: 'RESTORE_FREEFORM_LAYOUT' }))}
            onDelete={() => runContextAction(() => dispatch({ type: 'DELETE_NODE', nodeId: targetNodeId }))}
            onDeleteRelation={() => contextRelation && runContextAction(() => dispatch({ type: 'DELETE_RELATION', relationId: contextRelation.id }))}
            hasClipboard={clipboard !== null}
            hasFreeformHistory={document.layout.freeformOffsets !== null}
            canOutdent={contextNode !== null && contextNode.parentId !== null && document.nodes[contextNode.parentId].parentId !== null}
            canIndent={contextNode !== null && contextNode.parentId !== null && document.nodes[contextNode.parentId].childIds.indexOf(contextNode.id) > 0}
            onClose={closeContextMenu}
          />
        )
      })()}
      {commandPaletteOpen && (() => {
        const selected = selectedNodeId ? document.nodes[selectedNodeId] : document.nodes[document.rootId]
        const selectedId = selected.id
        return (
          <CommandPalette
            onClose={() => setCommandPaletteOpen(false)}
            actions={[
              { label: '新建子节点', detail: '在当前节点下继续展开想法', shortcut: 'Tab', run: () => dispatch({ type: 'ADD_CHILD', parentId: selectedId }) },
              { label: '新建同级节点', detail: '在当前层级增加一个主题', shortcut: '↵', disabled: selectedId === document.rootId, run: () => dispatch({ type: 'ADD_SIBLING', nodeId: selectedId }) },
              { label: '编辑当前节点', detail: '修改节点主题文字', shortcut: 'F2', run: () => editNode(selectedId) },
              { label: '创建关系', detail: '选择另一个节点建立横向关联', shortcut: '—', run: () => { selectNode(selectedId); setRelationSourceId(selectedId) } },
              { label: selected.collapsed ? '展开当前分支' : '折叠当前分支', detail: '收起或展开子节点', shortcut: 'Space', disabled: !selected.childIds.length, run: () => dispatch({ type: 'TOGGLE_COLLAPSE', nodeId: selectedId }) },
              { label: '折叠所有次级分支', detail: '保留当前层级，收起更深的内容', shortcut: '—', disabled: !selected.childIds.length, run: () => dispatch({ type: 'COLLAPSE_DESCENDANTS', nodeId: selectedId }) },
              { label: '展开所有次级分支', detail: '展开当前分支下的全部内容', shortcut: '—', disabled: !selected.childIds.length, run: () => dispatch({ type: 'EXPAND_DESCENDANTS', nodeId: selectedId }) },
              { label: '前往中心主题', detail: '定位并聚焦根节点', shortcut: '◎', run: focusRoot },
              { label: '降低层级', detail: '变为前一个同级节点的子节点', shortcut: '⌥ →', disabled: selectedId === document.rootId || (document.nodes[selectedId].parentId !== null && document.nodes[document.nodes[selectedId].parentId].childIds.indexOf(selectedId) === 0), run: () => dispatch({ type: 'INDENT_NODE', nodeId: selectedId }) },
              { label: '提升层级', detail: '移动到父节点之后', shortcut: '⇧ Tab', disabled: selectedId === document.rootId || document.nodes[selectedId].parentId === document.rootId, run: () => dispatch({ type: 'OUTDENT_NODE', nodeId: selectedId }) },
              { label: '复制当前分支', detail: '复制节点及全部子节点', shortcut: '⌘ C', run: () => copyNode(selectedId) },
              { label: '剪切当前分支', detail: '剪切节点及全部子节点', shortcut: '⌘ X', disabled: selectedId === document.rootId, run: () => cutNode(selectedId) },
              { label: '粘贴为子节点', detail: '将已复制分支粘贴到当前节点下', shortcut: '⌘ V', disabled: clipboard === null, run: () => pasteIntoNode(selectedId) },
              { label: '重置节点位置', detail: '移除人工微调，回到自动布局', shortcut: '—', run: () => dispatch({ type: 'RESET_NODE_OFFSET', nodeId: selectedId }) },
              { label: '删除当前分支', detail: '删除节点及其全部子节点', shortcut: '⌫', disabled: selectedId === document.rootId, run: () => dispatch({ type: 'DELETE_NODE', nodeId: selectedId }) },
            ]}
          />
        )
      })()}
    </div>
  )
}
