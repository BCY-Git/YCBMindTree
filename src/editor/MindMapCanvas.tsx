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
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Background,
  ControlButton,
  Controls,
  PanOnScrollMode,
  SelectionMode,
  ReactFlow,
  ViewportPortal,
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
import { NodeSearchDialog } from './NodeSearchDialog'
import { getTheme } from '../domain/themes'
import { getTreeEdgeAnchors } from './tree-edge'
import { retainDraggingNodePosition } from './drag-state'
import { resolveRegularTreeDragIntent, type TreeDropIntent } from './drag-intent'
import type { MindNode as DomainMindNode } from '../domain/document.types'

const nodeTypes = { mindNode: MindNode }
// 自由主题接近节点卡片或树枝时即可吸附；离开时使用更大阈值，避免临界位置来回闪烁。
const FREE_TOPIC_ATTACH_ENTER_DISTANCE = 116
const FREE_TOPIC_ATTACH_RETAIN_DISTANCE = 164

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

function distanceToSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y)
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy))
}

function distanceToRect(point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width))
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}

type DropIntent = TreeDropIntent
type DragPreview = { nodeId: string; intent: DropIntent }

function renderedSize(candidate: Node<MindNodeData>) {
  return {
    width: Number(candidate.style?.width ?? candidate.measured?.width ?? 160),
    height: Number(candidate.style?.minHeight ?? candidate.measured?.height ?? 44),
  }
}

export function MindMapCanvas() {
  const document = useEditorStore((state) => state.document)
  const theme = getTheme(document.theme.id)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectedNodeIds = useEditorStore((state) => state.selectedNodeIds)
  const selectedRelationId = useEditorStore((state) => state.selectedRelationId)
  const editingNodeId = useEditorStore((state) => state.editingNodeId)
  const focusRequestNodeId = useEditorStore((state) => state.focusRequestNodeId)
  const selectNode = useEditorStore((state) => state.selectNode)
  const setSelectedNodes = useEditorStore((state) => state.setSelectedNodes)
  const selectRelation = useEditorStore((state) => state.selectRelation)
  const editNode = useEditorStore((state) => state.editNode)
  const clearNodeFocusRequest = useEditorStore((state) => state.clearNodeFocusRequest)
  const dispatch = useEditorStore((state) => state.dispatch)
  const copyNode = useEditorStore((state) => state.copyNode)
  const cutNode = useEditorStore((state) => state.cutNode)
  const pasteIntoNode = useEditorStore((state) => state.pasteIntoNode)
  const clipboard = useEditorStore((state) => state.clipboard)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const [contextMenu, setContextMenu] = useState<{ position: ContextMenuPosition; nodeId: string | null; relationId: string | null } | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocusNodeId, setSearchFocusNodeId] = useState<string | null>(null)
  const [relationSourceId, setRelationSourceId] = useState<string | null>(null)
  const [freeTopicAttachmentParentId, setFreeTopicAttachmentParentId] = useState<string | null>(null)
  const [dropIntent, setDropIntent] = useState<DropIntent | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [flowNodes, setFlowNodes] = useState<Node<MindNodeData>[]>([])
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node<MindNodeData>, Edge> | null>(null)
  const [editingNodeHeights, setEditingNodeHeights] = useState<Map<string, number>>(new Map())
  const fittedDocumentIdRef = useRef<string | null>(null)
  const rightPointerRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const suppressContextMenuRef = useRef(false)

  const reportEditingNodeHeight = useCallback((nodeId: string, height: number | null) => {
    setEditingNodeHeights((current) => {
      const previous = current.get(nodeId)
      if (height === null) {
        if (previous === undefined) return current
        const next = new Map(current)
        next.delete(nodeId)
        return next
      }
      if (previous === height) return current
      const next = new Map(current)
      next.set(nodeId, height)
      return next
    })
  }, [])

  useEffect(() => setEditingNodeHeights(new Map()), [document.id])

  // ── 构建 React Flow nodes / edges（响应 document / selectedNodeId / theme 变化）─────────
  const { baseNodes, edges, basePositionsById, boundaryBoxes, summaryBoxes } = useMemo(() => {
    const stablePlaced = layoutTree(document, editingNodeHeights)
    // 同一父节点内的拖拽重排只在本地预览：先移除被拖节点，再按落点插回，
    // 其余节点立即腾位；真正写入文档仍等用户松开鼠标。
    let layoutDocument = document
    if (dragPreview?.intent.kind === 'sibling') {
      const previewNode = document.nodes[dragPreview.nodeId]
      const previewParent = previewNode?.parentId ? document.nodes[previewNode.parentId] : null
      if (previewNode && previewParent && previewParent.id === dragPreview.intent.parentId) {
        layoutDocument = structuredClone(document)
        const parent = layoutDocument.nodes[previewParent.id]
        const currentIndex = parent.childIds.indexOf(previewNode.id)
        parent.childIds = parent.childIds.filter((id) => id !== previewNode.id)
        const targetIndex = Math.max(0, Math.min(
          dragPreview.intent.index - (currentIndex >= 0 && currentIndex < dragPreview.intent.index ? 1 : 0),
          parent.childIds.length,
        ))
        parent.childIds.splice(targetIndex, 0, previewNode.id)
      }
    }
    const placed = layoutDocument === document ? stablePlaced : layoutTree(layoutDocument, editingNodeHeights)
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
        selected: selectedNodeIds.includes(item.id),
        // 编辑态的节点直接关闭 React Flow 拖拽，而不只依赖子元素的 nodrag class。
        // 这保证从文本首尾拖过时始终是浏览器原生选择，不会抢成节点拖动。
        draggable: editingNodeId !== item.id,
        data: {
          label: mindNode.topic,
          isRoot: item.id === document.rootId,
          isFreeTopic: mindNode.isFreeTopic,
          taskStatus: mindNode.taskStatus,
          priority: mindNode.priority,
          isDropTarget: (dropIntent?.kind === 'child' && dropIntent.parentId === item.id) || freeTopicAttachmentParentId === item.id,
          hasChildren: mindNode.childIds.length > 0,
          collapsed: mindNode.collapsed,
          accentColor: theme.palette[Math.max(0, depth - 1) % theme.palette.length],
          isRelationSource: relationSourceId === item.id,
          layoutHeight: item.height,
          onEditingHeightChange: (height) => reportEditingNodeHeight(item.id, height),
        },
        style: { width: item.width, height: item.height },
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
              stroke: mindNode.parentId === freeTopicAttachmentParentId || (dropIntent?.kind === 'sibling' && mindNode.parentId === dropIntent.parentId) ? '#38b7f0' : (theme.palette[Math.max(0, depthOf(item.id) - 1) % theme.palette.length] ?? theme.branch),
              strokeWidth: mindNode.parentId === freeTopicAttachmentParentId || (dropIntent?.kind === 'sibling' && mindNode.parentId === dropIntent.parentId) ? 3.4 : 2,
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
    const boundaryBoxes = document.boundaries.flatMap((boundary) => {
      const nodes = boundary.nodeIds.map((id) => positionedById.get(id)).filter((node): node is NonNullable<typeof node> => Boolean(node))
      if (nodes.length < 2) return []
      const left = Math.min(...nodes.map((node) => node.x)) - 18
      const top = Math.min(...nodes.map((node) => node.y)) - 27
      const right = Math.max(...nodes.map((node) => node.x + node.width)) + 18
      const bottom = Math.max(...nodes.map((node) => node.y + node.height)) + 18
      return [{ id: boundary.id, label: boundary.label, left, top, width: right - left, height: bottom - top }]
    })
    const summaryBoxes = document.summaries.flatMap((summary, summaryIndex) => {
      const nodes = summary.nodeIds.map((id) => positionedById.get(id)).filter((node): node is NonNullable<typeof node> => Boolean(node))
      if (nodes.length < 2) return []
      const rightmost = Math.max(...nodes.map((node) => node.x + node.width))
      const sources = nodes.map((node) => ({ x: node.x + node.width, y: node.y + node.height / 2 }))
      const centerY = (Math.min(...sources.map((source) => source.y)) + Math.max(...sources.map((source) => source.y))) / 2 + summaryIndex * 58
      const left = rightmost + 74
      const top = centerY - 22
      return [{ id: summary.id, topic: summary.topic, left, top, width: 172, height: 44, sources, targetY: centerY }]
    })
    return { baseNodes, edges: [...treeEdges, ...relationEdges], basePositionsById: new Map(stablePlaced.map((item) => [item.id, item])), boundaryBoxes, summaryBoxes }
  }, [document, dragPreview, dropIntent, editingNodeHeights, editingNodeId, freeTopicAttachmentParentId, relationSourceId, reportEditingNodeHeight, selectedNodeIds, selectedRelationId, theme])

  useEffect(() => {
    setFlowNodes((current) => retainDraggingNodePosition(baseNodes, current, draggingNodeId))
  }, [baseNodes, draggingNodeId])

  // 仅在首次打开或切换到另一张导图时自动适应视图；节点增删、编辑和布局更新都必须保留用户当前视角。
  useEffect(() => {
    if (!flowInstance || !baseNodes.length || fittedDocumentIdRef.current === document.id) return
    const frame = window.requestAnimationFrame(() => {
      flowInstance.fitView({ nodes: baseNodes, padding: .35, maxZoom: 1 })
      fittedDocumentIdRef.current = document.id
    })
    return () => window.cancelAnimationFrame(frame)
  }, [baseNodes, document.id, flowInstance])

  useEffect(() => {
    if (!focusRequestNodeId) return
    const node = baseNodes.find((item) => item.id === focusRequestNodeId)
    if (!node || !flowInstance) return
    flowInstance.fitView({ nodes: [node], padding: 1.15, maxZoom: 1.15, duration: 260 })
    clearNodeFocusRequest()
  }, [baseNodes, clearNodeFocusRequest, flowInstance, focusRequestNodeId])

  const focusRoot = useCallback(() => {
    const rootNode = baseNodes.find((node) => node.id === document.rootId)
    selectNode(document.rootId)
    if (rootNode) flowInstance?.fitView({ nodes: [rootNode], padding: 1.5, maxZoom: 1.05, duration: 280 })
  }, [baseNodes, document.rootId, flowInstance, selectNode])

  const revealSearchResult = useCallback((nodeId: string) => {
    if (dispatch({ type: 'REVEAL_NODE', nodeId })) setSearchFocusNodeId(nodeId)
    setSearchOpen(false)
  }, [dispatch])

  useEffect(() => {
    if (!searchFocusNodeId) return
    const node = baseNodes.find((item) => item.id === searchFocusNodeId)
    if (!node || !flowInstance) return
    flowInstance.fitView({ nodes: [node], padding: 1.15, maxZoom: 1.15, duration: 260 })
    setSearchFocusNodeId(null)
  }, [baseNodes, flowInstance, searchFocusNodeId])

  const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
    if (relationSourceId) {
      if (node.id !== relationSourceId && dispatch({ type: 'CREATE_RELATION', sourceId: relationSourceId, targetId: node.id })) setRelationSourceId(null)
      return
    }
    selectNode(node.id, event.metaKey || event.ctrlKey)
  }, [dispatch, relationSourceId, selectNode])
  const commitSelectionBox = useCallback(() => {
    const nextIds = flowInstance?.getNodes().filter((node) => node.selected).map((node) => node.id) ?? []
    const currentIds = useEditorStore.getState().selectedNodeIds
    if (nextIds.length === currentIds.length && nextIds.every((id, index) => id === currentIds[index])) return
    setSelectedNodes(nextIds)
  }, [flowInstance, setSelectedNodes])
  // ── React Flow 节点拖拽结束：计算相对于自动布局基准位置的偏移量 ──────────────
  const getDragOffset = useCallback((node: Node<MindNodeData>) => {
    const original = basePositionsById.get(node.id)
    if (!original) return null
    return { x: node.position.x - original.x, y: node.position.y - original.y }
  }, [basePositionsById])
  // 自由主题可直接落到任意母节点卡片或相邻树枝；采用进/出两档距离，避免边缘来回闪烁。
  const attachmentParentNearBranch = useCallback((dragged: Node<MindNodeData>, retainedParentId: string | null = null) => {
    const { width, height } = renderedSize(dragged)
    const point = { x: dragged.position.x + width / 2, y: dragged.position.y + height / 2 }
    const distances = new Map<string, number>()
    const consider = (parentId: string, distance: number) => {
      const current = distances.get(parentId)
      if (current === undefined || distance < current) distances.set(parentId, distance)
    }
    Object.values(document.nodes).forEach((candidate) => {
      if (candidate.isFreeTopic) return
      const position = basePositionsById.get(candidate.id)
      if (position) consider(candidate.id, distanceToRect(point, position))
    })
    Object.values(document.nodes).forEach((child) => {
      if (!child.parentId || child.isFreeTopic) return
      const parent = basePositionsById.get(child.parentId)
      const target = basePositionsById.get(child.id)
      if (!parent || !target) return
      const distance = distanceToSegment(point, { x: parent.x + parent.width, y: parent.y + parent.height / 2 }, { x: target.x, y: target.y + target.height / 2 })
      consider(child.parentId, distance)
    })
    if (retainedParentId && (distances.get(retainedParentId) ?? Number.POSITIVE_INFINITY) <= FREE_TOPIC_ATTACH_RETAIN_DISTANCE) return retainedParentId
    let closestParentId: string | null = null
    let closestDistance = Number.POSITIVE_INFINITY
    distances.forEach((distance, parentId) => {
      if (distance < closestDistance) { closestParentId = parentId; closestDistance = distance }
    })
    return closestDistance <= FREE_TOPIC_ATTACH_ENTER_DISTANCE ? closestParentId : null
  }, [basePositionsById, document.nodes])
  const dropIntentNearTree = useCallback((dragged: Node<MindNodeData>): DropIntent | null => {
    const draggedSize = renderedSize(dragged)
    const point = { x: dragged.position.x + draggedSize.width / 2, y: dragged.position.y + draggedSize.height / 2 }
    const wouldCreateCycle = (parentId: string) => {
      let current: DomainMindNode | undefined = document.nodes[parentId]
      while (current) {
        if (current.id === dragged.id) return true
        current = current.parentId ? document.nodes[current.parentId] : undefined
      }
      return false
    }
    const target = baseNodes.find((candidate) => {
      if (candidate.id === dragged.id || candidate.data.isFreeTopic || wouldCreateCycle(candidate.id)) return false
      const size = renderedSize(candidate)
      return point.x >= candidate.position.x && point.x <= candidate.position.x + size.width
        && point.y >= candidate.position.y && point.y <= candidate.position.y + size.height
    })
    if (target) return { parentId: target.id, index: document.nodes[target.id].childIds.length, kind: 'child' }

    let closestParentId: string | null = null
    let closestIndex = 0
    let closestKind: DropIntent['kind'] = 'sibling'
    let closestDistance = Number.POSITIVE_INFINITY
    Object.values(document.nodes).forEach((child) => {
      if (!child.parentId || child.isFreeTopic || wouldCreateCycle(child.parentId)) return
      const parent = basePositionsById.get(child.parentId)
      const targetPosition = basePositionsById.get(child.id)
      if (!parent || !targetPosition) return
      const distance = distanceToSegment(point, { x: parent.x + parent.width, y: parent.y + parent.height / 2 }, { x: targetPosition.x, y: targetPosition.y + targetPosition.height / 2 })
      if (distance > 56 || distance >= closestDistance) return
      const childIndex = document.nodes[child.parentId].childIds.indexOf(child.id)
      closestParentId = child.parentId
      closestIndex = childIndex + (point.y > targetPosition.y + targetPosition.height / 2 ? 1 : 0)
      closestKind = 'sibling'
      closestDistance = distance
    })
    return closestParentId ? { parentId: closestParentId, index: closestIndex, kind: closestKind } : null
  }, [baseNodes, basePositionsById, document.nodes])
  const siblingReorderIntent = useCallback((dragged: Node<MindNodeData>): DropIntent | null => {
    const current = document.nodes[dragged.id]
    if (!current?.parentId || current.isFreeTopic) return null
    const offset = getDragOffset(dragged)
    if (!offset || Math.abs(offset.y) < 18) return null
    const siblings = document.nodes[current.parentId].childIds
    const currentIndex = siblings.indexOf(current.id)
    if (currentIndex < 0) return null
    const size = renderedSize(dragged)
    const centerY = dragged.position.y + size.height / 2
    const nextSibling = siblings
      .filter((id) => id !== current.id)
      .map((id) => ({ id, position: basePositionsById.get(id) }))
      .filter((item): item is { id: string; position: NonNullable<typeof item.position> } => Boolean(item.position))
      .sort((a, b) => a.position.y - b.position.y)
      .find((item) => centerY < item.position.y + item.position.height / 2)
    const index = nextSibling ? siblings.indexOf(nextSibling.id) : siblings.length
    if (index === currentIndex || index === currentIndex + 1) return null
    return { parentId: current.parentId, index, kind: 'sibling' }
  }, [basePositionsById, document.nodes, getDragOffset])
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
  // 普通树节点只会重排或调整层级；仅自由主题保留自由位置。
  const onNodeDragStop: OnNodeDrag<Node<MindNodeData>> = useCallback((event, node) => {
    setDraggingNodeId(null)
    setFreeTopicAttachmentParentId(null)
    setDropIntent(null)
    setDragPreview(null)
    const offset = getDragOffset(node)
    if (node.id === document.rootId) {
      if (!offset) return
      dispatch({ type: 'TRANSLATE_DOCUMENT', deltaX: offset.x, deltaY: offset.y })
      return
    }
    const mindNode = document.nodes[node.id]
    if (mindNode?.isFreeTopic) {
      const parentId = freeTopicAttachmentParentId ?? attachmentParentNearBranch(node)
      if (parentId) {
        dispatch({ type: 'ATTACH_FREE_TOPIC', nodeId: node.id, parentId })
        return
      }
      if (offset) dispatch({ type: 'UPDATE_NODE_OFFSET', nodeId: node.id, offsetX: mindNode.offsetX + offset.x, offsetY: mindNode.offsetY + offset.y })
      else setFlowNodes(baseNodes)
      return
    }
    const intent = resolveRegularTreeDragIntent({
      shiftKey: Boolean((event as MouseEvent).shiftKey),
      siblingIntent: siblingReorderIntent(node),
      structuralIntent: dropIntentNearTree(node),
    })
    if (intent) {
      const moved = dispatch({ type: 'MOVE_NODE', nodeId: node.id, newParentId: intent.parentId, index: intent.index })
      if (!moved) setFlowNodes(baseNodes)
      return
    }
    setFlowNodes(baseNodes)
  }, [attachmentParentNearBranch, baseNodes, dispatch, document.nodes, dropIntentNearTree, freeTopicAttachmentParentId, getDragOffset, siblingReorderIntent])
  const onNodeDrag: OnNodeDrag<Node<MindNodeData>> = useCallback((event, node) => {
    setDraggingNodeId((current) => current === node.id ? current : node.id)
    if (document.nodes[node.id]?.isFreeTopic) {
      setFreeTopicAttachmentParentId((current) => {
        const next = attachmentParentNearBranch(node, current)
        return current === next ? current : next
      })
      setDragPreview(null)
      return
    }
    const next = resolveRegularTreeDragIntent({
      shiftKey: Boolean((event as MouseEvent).shiftKey),
      siblingIntent: siblingReorderIntent(node),
      structuralIntent: dropIntentNearTree(node),
    })
    setDropIntent((current) => current?.parentId === next?.parentId && current?.index === next?.index && current?.kind === next?.kind ? current : next)
    const currentParentId = document.nodes[node.id]?.parentId
    const preview = next?.kind === 'sibling' && next.parentId === currentParentId ? { nodeId: node.id, intent: next } : null
    setDragPreview((current) => current?.nodeId === preview?.nodeId && current?.intent.parentId === preview?.intent.parentId && current?.intent.index === preview?.intent.index ? current : preview)
  }, [attachmentParentNearBranch, document.nodes, dropIntentNearTree, siblingReorderIntent])
  // ── 右键菜单：画布空白处打开画布菜单，节点上打开节点菜单 ───────────────────────
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const openContextMenu = useCallback((event: MouseEvent, nodeId: string | null) => {
    event.preventDefault()
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false
      return
    }
    // 对已经在多选集内的节点右键，不清掉多选；否则回到单选。
    if (nodeId && !selectedNodeIds.includes(nodeId)) selectNode(nodeId)
    setContextMenu({ position: { x: event.clientX, y: event.clientY }, nodeId, relationId: null })
  }, [selectNode, selectedNodeIds])

  const canCreateBoundary = useMemo(() => {
    if (selectedNodeIds.length < 2) return false
    const selected = selectedNodeIds.map((id) => document.nodes[id])
    const parentId = selected[0]?.parentId
    return Boolean(parentId && selected.every((node) => node && !node.isFreeTopic && node.parentId === parentId))
  }, [document.nodes, selectedNodeIds])

  const selectionToolbar = useMemo(() => {
    if (selectedNodeIds.length < 2) return null
    const nodes = selectedNodeIds.map((id) => basePositionsById.get(id)).filter((node): node is NonNullable<typeof node> => Boolean(node))
    if (nodes.length < 2) return null
    const left = (Math.min(...nodes.map((node) => node.x)) + Math.max(...nodes.map((node) => node.x + node.width))) / 2
    const top = Math.min(...nodes.map((node) => node.y)) - 38
    return { left, top, count: nodes.length }
  }, [basePositionsById, selectedNodeIds])

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
      if (meta && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchOpen(true); return }
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
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        const selectedIds = editor.selectedNodeIds.filter((id) => id !== editor.document.rootId)
        const selectedSet = new Set(selectedIds)
        const topLevelIds = selectedIds.filter((id) => {
          let current = editor.document.nodes[id]
          while (current?.parentId) {
            if (selectedSet.has(current.parentId)) return false
            current = editor.document.nodes[current.parentId]
          }
          return true
        })
        if (topLevelIds.length) topLevelIds.forEach((id) => dispatch({ type: 'DELETE_NODE', nodeId: id }))
        return
      }
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
    } as CSSProperties} onPointerDownCapture={(event) => {
      if (event.button === 2) rightPointerRef.current = { x: event.clientX, y: event.clientY, moved: false }
    }} onPointerMoveCapture={(event) => {
      const start = rightPointerRef.current
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) start.moved = true
    }} onPointerUpCapture={(event) => {
      const start = rightPointerRef.current
      if (event.button !== 2 || !start) return
      if (start.moved) {
        suppressContextMenuRef.current = true
        window.setTimeout(() => { suppressContextMenuRef.current = false }, 120)
      }
      rightPointerRef.current = null
    }} onDoubleClickCapture={(event) => {
      const target = event.target as HTMLElement
      if (relationSourceId || !flowInstance || target.closest('.react-flow__node, .react-flow__controls')) return
      dispatch({ type: 'ADD_CHILD', parentId: document.rootId })
    }}>
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onInit={setFlowInstance}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onNodeDrag={onNodeDrag}
        // 仅在框选手势结束时读取内部选择，避免 React Flow 的 nodes 同步通知反向写回状态。
        onSelectionEnd={commitSelectionBox}
        onNodeContextMenu={(event, node) => openContextMenu(event.nativeEvent, node.id)}
        onPaneContextMenu={(event) => openContextMenu('nativeEvent' in event ? event.nativeEvent : event, null)}
        onEdgeClick={(event, edge) => { event.stopPropagation(); selectRelation(edge.id) }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault()
          selectRelation(edge.id)
          setContextMenu({ position: { x: event.clientX, y: event.clientY }, nodeId: null, relationId: edge.id })
        }}
        onPaneClick={() => { setRelationSourceId(null); selectNode(null); closeContextMenu() }}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control']}
        selectionMode={SelectionMode.Partial}
        // 新节点创建后会自动进入输入态；关闭焦点自动平移，避免每次新增节点都打断用户当前视角。
        autoPanOnNodeFocus={false}
        // 设计软件式画布交互：普通滚轮纵向浏览；按住 ⌘ / ⌥ 才缩放；右键平移画布。
        zoomOnScroll={false}
        zoomActivationKeyCode={['Meta', 'Alt']}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Vertical}
        panOnDrag={[2]}
        zoomOnDoubleClick={false}
        // 大图仅挂载当前视口附近的节点，避免远处卡片参与每次输入与拖拽的渲染。
        onlyRenderVisibleElements
        minZoom={0.25}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color={theme.grid} />
        <ViewportPortal>
          {selectionToolbar && <div className="selection-toolbar" style={{ left: selectionToolbar.left, top: selectionToolbar.top }}>
            <strong>已选 {selectionToolbar.count} 项</strong>
            <button disabled={!canCreateBoundary} onClick={() => dispatch({ type: 'CREATE_BOUNDARY', nodeIds: selectedNodeIds })}>边界</button>
            <button disabled={!canCreateBoundary} onClick={() => dispatch({ type: 'CREATE_SUMMARY', nodeIds: selectedNodeIds })}>摘要</button>
            <button className="selection-toolbar__delete" onClick={() => dispatch({ type: 'DELETE_NODES', nodeIds: selectedNodeIds })}>删除</button>
          </div>}
          {boundaryBoxes.map((boundary) => (
            <div key={boundary.id} className="mind-boundary" style={{ left: boundary.left, top: boundary.top, width: boundary.width, height: boundary.height }}>
              <button
                className="mind-boundary__label"
                title="双击修改边界名称"
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  const label = window.prompt('边界名称', boundary.label)
                  if (label !== null) dispatch({ type: 'UPDATE_BOUNDARY_LABEL', boundaryId: boundary.id, label })
                }}
              >{boundary.label}</button>
              <button className="mind-boundary__delete" title="删除边界" onClick={() => dispatch({ type: 'DELETE_BOUNDARY', boundaryId: boundary.id })}>×</button>
            </div>
          ))}
          {summaryBoxes.map((summary) => (
            <svg key={`${summary.id}-connector`} className="mind-summary-connector" style={{ width: summary.left + 1, height: summary.top + summary.height + 1 }} aria-hidden="true">
              {summary.sources.map((source, index) => <path key={index} d={`M ${source.x + 8} ${source.y} C ${source.x + 36} ${source.y}, ${summary.left - 28} ${summary.targetY}, ${summary.left} ${summary.targetY}`} />)}
            </svg>
          ))}
          {summaryBoxes.map((summary) => (
            <div key={summary.id} className="mind-summary" style={{ left: summary.left, top: summary.top, width: summary.width, minHeight: summary.height }}>
              <button
                className="mind-summary__topic"
                title="双击修改摘要"
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  const topic = window.prompt('摘要内容', summary.topic)
                  if (topic !== null) dispatch({ type: 'UPDATE_SUMMARY_TOPIC', summaryId: summary.id, topic })
                }}
              >{summary.topic}</button>
              <button className="mind-summary__delete" title="删除摘要" onClick={() => dispatch({ type: 'DELETE_SUMMARY', summaryId: summary.id })}>×</button>
            </div>
          ))}
        </ViewportPortal>
        <Controls showInteractive={false}><ControlButton onClick={() => setSearchOpen(true)} title="搜索导图">⌕</ControlButton><ControlButton onClick={focusRoot} title="前往中心主题">◎</ControlButton></Controls>
      </ReactFlow>
      {relationSourceId && <div className="relation-creation-hint" role="status"><strong>正在创建关系</strong><span>请选择另一个节点作为目标 · Esc 取消</span></div>}
      {freeTopicAttachmentParentId && <div className="free-topic-attach-hint" role="status">松开即可添加到高亮分支</div>}
      {dropIntent && <div className="tree-drop-hint" role="status">{dropIntent.kind === 'child' ? '松开即可成为该节点的子节点' : `松开即可插入此分支的第 ${dropIntent.index + 1} 个位置`}</div>}
      {searchOpen && <NodeSearchDialog document={document} onClose={() => setSearchOpen(false)} onSelect={revealSearchResult} onCreate={(topic) => { const parentId = selectedNodeId ?? document.rootId; if (dispatch({ type: 'ADD_CHILD', parentId, topic })) setSearchOpen(false) }} />}
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
            onAddFreeTopic={() => runContextAction(() => {
              const position = flowInstance?.screenToFlowPosition(contextMenu.position)
              if (position) dispatch({ type: 'ADD_FREE_TOPIC', x: position.x, y: position.y })
            })}
            onAttachToRoot={() => runContextAction(() => dispatch({ type: 'ATTACH_FREE_TOPIC', nodeId: targetNodeId, parentId: document.rootId }))}
            onEdit={() => runContextAction(() => editNode(targetNodeId))}
            onCreateRelation={() => runContextAction(() => { selectNode(targetNodeId); setRelationSourceId(targetNodeId) })}
            onCreateBoundary={() => runContextAction(() => dispatch({ type: 'CREATE_BOUNDARY', nodeIds: selectedNodeIds }))}
            onCreateSummary={() => runContextAction(() => dispatch({ type: 'CREATE_SUMMARY', nodeIds: selectedNodeIds }))}
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
            canCreateBoundary={canCreateBoundary}
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
              { label: '新建子节点', detail: '在当前节点下继续展开想法', shortcut: '工具栏', disabled: selected.isFreeTopic, run: () => dispatch({ type: 'ADD_CHILD', parentId: selectedId }) },
              { label: '新建同级节点', detail: '在当前层级增加一个主题', shortcut: '↵', disabled: selectedId === document.rootId || selected.isFreeTopic, run: () => dispatch({ type: 'ADD_SIBLING', nodeId: selectedId }) },
              ...(selected.isFreeTopic ? [{ label: '附加到主节点', detail: '转为中心主题下的一级分支，并自动排列', shortcut: '—', run: () => dispatch({ type: 'ATTACH_FREE_TOPIC', nodeId: selectedId, parentId: document.rootId }) }] : []),
              { label: '编辑当前节点', detail: '修改节点主题文字', shortcut: 'F2', run: () => editNode(selectedId) },
              { label: '创建关系', detail: '选择另一个节点建立横向关联', shortcut: '—', run: () => { selectNode(selectedId); setRelationSourceId(selectedId) } },
              { label: '为所选节点创建边界', detail: '圈定两个或以上同级节点，不改变树结构', shortcut: '—', disabled: !canCreateBoundary, run: () => dispatch({ type: 'CREATE_BOUNDARY', nodeIds: selectedNodeIds }) },
              { label: '为所选节点创建摘要', detail: '为同级分支写下一个结论，不改变树结构', shortcut: '—', disabled: !canCreateBoundary, run: () => dispatch({ type: 'CREATE_SUMMARY', nodeIds: selectedNodeIds }) },
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
