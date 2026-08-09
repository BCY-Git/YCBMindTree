/**
 * MindMapCanvas — 思维导图画布主视图。
 *
 * 整合了 @xyflow/react 画布、键盘事件路由、右键菜单和命令面板。
 *
 * 职责：
 * - 根据 document + layout 生成 nodes / edges，交给 React Flow 渲染
 * - 监听键盘快捷键（Tab/Enter/Space/Delete/方向键等），派发对应命令
 * - 处理节点拖拽：同级重排、落到节点上调整层级、远距离拖出独立主题树，
 *   中心主题拖拽平移整张导图
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
  MarkerType,
  type Edge,
  type Connection,
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
import { retainDraggingNodePosition, translateDraggedSubtree } from './drag-state'
import { resolveRegularTreeDragIntent, shouldDetachTreeBranch, type TreeDropIntent } from './drag-intent'
import type { MindMapDocument, MindNode as DomainMindNode } from '../domain/document.types'
import { loadTags, type Tag } from '../domain/tag-library'
import { hasActiveFilter, useNodeFilterStore } from './filter-store'
import { listAllDepositProvenance, saveNodeAttachment } from '../persistence/database'
import { findClipboardImageFile } from './clipboard-image'
import { relationDraftGeometry, relationTopicPositionAt } from './relation-draft'
import { projectFocusedDocument } from '../focus/focus-projection'
import { RelationEdge, type RelationEdgeData } from './RelationEdge'
import {
  loadSemanticZoomEnabled,
  resolveSemanticZoomLevel,
  saveSemanticZoomEnabled,
  semanticZoomLevelLabel,
  shouldShowRelationLabel,
  type SemanticZoomLevel,
} from './semantic-zoom'

const nodeTypes = { mindNode: MindNode }
const edgeTypes = { relation: RelationEdge }
// 自由主题接近节点卡片或树枝时即可吸附；离开时使用更大阈值，避免临界位置来回闪烁。
const FREE_TOPIC_ATTACH_ENTER_DISTANCE = 116
const FREE_TOPIC_ATTACH_RETAIN_DISTANCE = 164

function fitViewPadding() {
  return window.matchMedia('(max-width: 620px)').matches ? .08 : .35
}

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

function collectSubtreeNodeIds(document: MindMapDocument, nodeId: string) {
  const result: string[] = []
  const visit = (currentId: string) => {
    const node = document.nodes[currentId]
    if (!node) return
    result.push(currentId)
    node.childIds.forEach(visit)
  }
  visit(nodeId)
  return result
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

function sameDropIntent(left: DropIntent | null, right: DropIntent | null) {
  return left?.parentId === right?.parentId && left?.index === right?.index && left?.kind === right?.kind
}

function renderedSize(candidate: Node<MindNodeData>) {
  return {
    width: Number(candidate.style?.width ?? candidate.measured?.width ?? 160),
    height: Number(candidate.style?.minHeight ?? candidate.measured?.height ?? 44),
  }
}

export function MindMapCanvas({ workspaceDocuments, onRevealWorkspaceNode, focusRootId = null, onChangeFocusRoot }: {
  workspaceDocuments: MindMapDocument[]
  onRevealWorkspaceNode: (documentId: string, nodeId: string) => void
  focusRootId?: string | null
  onChangeFocusRoot?: (nodeId: string | null) => void
}) {
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
  const relationCreationRequestSourceIds = useEditorStore((state) => state.relationCreationRequestSourceIds)
  const clearRelationCreationRequest = useEditorStore((state) => state.clearRelationCreationRequest)
  const dispatch = useEditorStore((state) => state.dispatch)
  const copyNode = useEditorStore((state) => state.copyNode)
  const cutNode = useEditorStore((state) => state.cutNode)
  const pasteIntoNode = useEditorStore((state) => state.pasteIntoNode)
  const clipboard = useEditorStore((state) => state.clipboard)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const filter = useNodeFilterStore((state) => state.filter)
  const [tags, setTags] = useState<Tag[]>(loadTags)
  const [contextMenu, setContextMenu] = useState<{ position: ContextMenuPosition; nodeId: string | null; relationId: string | null } | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchProvenance, setSearchProvenance] = useState<Awaited<ReturnType<typeof listAllDepositProvenance>>>([])
  const [searchFocusNodeId, setSearchFocusNodeId] = useState<string | null>(null)
  const [relationSourceIds, setRelationSourceIds] = useState<string[]>([])
  const [relationPointer, setRelationPointer] = useState<{ x: number; y: number } | null>(null)
  const [freeTopicAttachmentParentId, setFreeTopicAttachmentParentId] = useState<string | null>(null)
  const [dropIntent, setDropIntent] = useState<DropIntent | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [detachingNodeId, setDetachingNodeId] = useState<string | null>(null)
  const [flowNodes, setFlowNodes] = useState<Node<MindNodeData>[]>([])
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node<MindNodeData>, Edge> | null>(null)
  const [semanticZoomEnabled, setSemanticZoomEnabled] = useState(loadSemanticZoomEnabled)
  const [semanticZoomLevel, setSemanticZoomLevel] = useState<SemanticZoomLevel>(() => resolveSemanticZoomLevel(null, 1, loadSemanticZoomEnabled()))
  const [editingNodeHeights, setEditingNodeHeights] = useState<Map<string, number>>(new Map())
  const [pasteAttachmentStatus, setPasteAttachmentStatus] = useState<string | null>(null)
  const [interactionStatus, setInteractionStatus] = useState<string | null>(null)
  const viewDocument = useMemo(() => focusRootId ? projectFocusedDocument(document, focusRootId) : document, [document, focusRootId])
  const fittedDocumentIdRef = useRef<string | null>(null)
  const rightPointerRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const suppressContextMenuRef = useRef(false)
  const dropIntentRef = useRef<DropIntent | null>(null)
  const pendingDropIntentRef = useRef<{ intent: DropIntent | null; count: number } | null>(null)
  const activeDragNodeIdRef = useRef<string | null>(null)
  const interactionStatusTimerRef = useRef<number | null>(null)

  const showInteractionStatus = useCallback((message: string) => {
    if (interactionStatusTimerRef.current !== null) window.clearTimeout(interactionStatusTimerRef.current)
    setInteractionStatus(message)
    interactionStatusTimerRef.current = window.setTimeout(() => setInteractionStatus(null), 2200)
  }, [])

  useEffect(() => () => {
    if (interactionStatusTimerRef.current !== null) window.clearTimeout(interactionStatusTimerRef.current)
  }, [])

  useEffect(() => {
    const reload = () => setTags(loadTags())
    window.addEventListener('mindtree:tags-changed', reload)
    return () => window.removeEventListener('mindtree:tags-changed', reload)
  }, [])

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
    const stablePlaced = layoutTree(viewDocument, editingNodeHeights)
    // 同一父节点内的拖拽重排只在本地预览：先移除被拖节点，再按落点插回，
    // 其余节点立即腾位；真正写入文档仍等用户松开鼠标。
    let layoutDocument = viewDocument
    if (dragPreview?.intent.kind === 'sibling') {
      const previewNode = viewDocument.nodes[dragPreview.nodeId]
      const previewParent = previewNode?.parentId ? viewDocument.nodes[previewNode.parentId] : null
      if (previewNode && previewParent && previewParent.id === dragPreview.intent.parentId) {
        layoutDocument = structuredClone(viewDocument)
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
    const placed = layoutDocument === viewDocument ? stablePlaced : layoutTree(layoutDocument, editingNodeHeights)
    const visibleIds = new Set(placed.map((item) => item.id))
    const positionedById = new Map(placed.map((item) => [item.id, item]))
    const depthOf = (nodeId: string) => {
      let depth = 0
      let current = document.nodes[nodeId]
      while (current.parentId) { depth += 1; current = document.nodes[current.parentId] }
      return depth
    }
    const tagById = new Map(tags.map((tag) => [tag.id, tag]))
    const matchesFilter = (mindNode: DomainMindNode) => {
      if (!hasActiveFilter(filter)) return true
      const tagMatches = filter.tags.length === 0 || filter.tags.some((tagId) => mindNode.tagIds.includes(tagId))
      const markMatches = filter.marks.length === 0 || filter.marks.some((mark) => mindNode.marks.includes(mark))
      const statusMatches = filter.statuses.length === 0 || filter.statuses.includes(mindNode.taskStatus)
      const priorityMatches = filter.priorities.length === 0 || filter.priorities.includes(mindNode.priority)
      return tagMatches && markMatches && statusMatches && priorityMatches
    }
    const matchedById = new Map<string, boolean>()
    const descendantCountById = new Map<string, number>()
    const countDescendants = (nodeId: string): number => {
      const cached = descendantCountById.get(nodeId)
      if (cached !== undefined) return cached
      const count = document.nodes[nodeId]?.childIds.reduce((total, childId) => total + 1 + countDescendants(childId), 0) ?? 0
      descendantCountById.set(nodeId, count)
      return count
    }
    const baseNodes: Node<MindNodeData>[] = placed.map((item) => {
      const mindNode = document.nodes[item.id]
      const depth = depthOf(item.id)
      const matched = matchesFilter(mindNode)
      matchedById.set(item.id, matched)
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
          marks: mindNode.marks,
          tags: mindNode.tagIds.flatMap((id) => {
            const tag = tagById.get(id)
            return tag ? [tag] : []
          }),
          isDropTarget: (dropIntent?.kind === 'child' && dropIntent.parentId === item.id) || freeTopicAttachmentParentId === item.id,
          hasChildren: mindNode.childIds.length > 0,
          collapsed: mindNode.collapsed,
          hiddenDescendantCount: countDescendants(item.id),
          accentColor: theme.palette[Math.max(0, depth - 1) % theme.palette.length],
          isRelationSource: relationSourceIds.includes(item.id),
          imageAttachment: mindNode.attachments.find((attachment) => attachment.type.startsWith('image/')) ?? null,
          // 语义层级在渲染前单独覆盖，不能成为 layoutTree 的输入或触发布局重算。
          semanticZoomLevel: 'workspace',
          depth,
          layoutHeight: item.height,
          onEditingHeightChange: (height) => reportEditingNodeHeight(item.id, height),
        },
        style: { width: item.width, height: item.height, opacity: matched ? 1 : .18 },
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
            className: `mind-tree-edge mind-tree-edge--depth-${Math.min(depthOf(item.id), 4)}`,
            reconnectable: false,
            style: {
              stroke: mindNode.parentId === freeTopicAttachmentParentId || (dropIntent?.kind === 'sibling' && mindNode.parentId === dropIntent.parentId) ? '#38b7f0' : (theme.palette[Math.max(0, depthOf(item.id) - 1) % theme.palette.length] ?? theme.branch),
              strokeWidth: mindNode.parentId === freeTopicAttachmentParentId || (dropIntent?.kind === 'sibling' && mindNode.parentId === dropIntent.parentId) ? 3.4 : 2,
              opacity: !hasActiveFilter(filter) || matchedById.get(mindNode.parentId) || matchedById.get(item.id) ? 1 : .14,
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
      const relationColor = relation.color ?? theme.branch
      return [{
        id: relation.id,
        source: relation.sourceId,
        target: relation.targetId,
        sourceHandle: targetIsRight ? 'relation-source-right' : 'relation-source-left',
        targetHandle: targetIsRight ? 'relation-target-left' : 'relation-target-right',
        type: 'relation',
        reconnectable: 'target',
        className: `mind-relation-edge ${isSelected ? 'is-selected' : ''}`,
        selectable: true,
        selected: isSelected,
        markerEnd: { type: MarkerType.ArrowClosed, color: relationColor, width: 16, height: 16 },
        data: {
          label: relation.label,
          lineStyle: relation.lineStyle,
          color: relationColor,
          controlOffsetX: relation.controlOffsetX,
          controlOffsetY: relation.controlOffsetY,
          opacity: isSelected ? 1 : (!hasActiveFilter(filter) || matchedById.get(relation.sourceId) || matchedById.get(relation.targetId) ? .82 : .14),
          showLabel: true,
          onSelect: (relationId: string) => {
            setRelationSourceIds([])
            setRelationPointer(null)
            selectRelation(relationId)
          },
          onLabelCommit: (relationId: string, label: string) => dispatch({ type: 'UPDATE_RELATION_LABEL', relationId, label }),
          onControlCommit: (relationId: string, controlOffsetX: number, controlOffsetY: number) => dispatch({ type: 'UPDATE_RELATION_STYLE', relationId, patch: { controlOffsetX, controlOffsetY } }),
        },
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
  }, [dispatch, document, dragPreview, dropIntent, editingNodeHeights, editingNodeId, filter, freeTopicAttachmentParentId, relationSourceIds, reportEditingNodeHeight, selectRelation, selectedNodeIds, selectedRelationId, tags, theme, viewDocument])

  const onViewportMove = useCallback((_: MouseEvent | TouchEvent | null, viewport: { zoom: number }) => {
    setSemanticZoomLevel((current) => resolveSemanticZoomLevel(current, viewport.zoom, semanticZoomEnabled))
  }, [semanticZoomEnabled])

  const initializeFlow = useCallback((instance: ReactFlowInstance<Node<MindNodeData>, Edge>) => {
    setFlowInstance(instance)
    setSemanticZoomLevel(resolveSemanticZoomLevel(null, instance.getZoom(), semanticZoomEnabled))
  }, [semanticZoomEnabled])

  const toggleSemanticZoom = useCallback(() => {
    const nextEnabled = !semanticZoomEnabled
    saveSemanticZoomEnabled(nextEnabled)
    setSemanticZoomEnabled(nextEnabled)
    setSemanticZoomLevel(resolveSemanticZoomLevel(null, flowInstance?.getZoom() ?? 1, nextEnabled))
  }, [flowInstance, semanticZoomEnabled])

  const draggedSubtreeIds = useMemo(() => {
    if (!draggingNodeId) return new Set<string>()
    if (draggingNodeId === document.rootId) return new Set(Object.keys(document.nodes))
    const ids = new Set<string>()
    const visit = (nodeId: string) => {
      ids.add(nodeId)
      document.nodes[nodeId]?.childIds.forEach(visit)
    }
    visit(draggingNodeId)
    return ids
  }, [document.nodes, document.rootId, draggingNodeId])

  useEffect(() => {
    setFlowNodes((current) => retainDraggingNodePosition(baseNodes, current, draggingNodeId, draggedSubtreeIds))
  }, [baseNodes, draggedSubtreeIds, draggingNodeId])

  const renderedFlowNodes = useMemo(() => flowNodes.map((node) => node.data.semanticZoomLevel === semanticZoomLevel
    ? node
    : { ...node, data: { ...node.data, semanticZoomLevel } }), [flowNodes, semanticZoomLevel])

  const renderedEdges = useMemo(() => edges.map((edge) => {
    if (!String(edge.className ?? '').includes('mind-relation-edge')) return edge
    const selected = edge.id === selectedRelationId
    if (shouldShowRelationLabel(semanticZoomLevel, selected)) return edge
    const data = edge.data as RelationEdgeData | undefined
    return { ...edge, data: data ? { ...data, showLabel: false, opacity: Math.min(data.opacity, .42) } : data }
  }), [edges, selectedRelationId, semanticZoomLevel])

  // 仅在首次打开或切换到另一张导图时自动适应视图；节点增删、编辑和布局更新都必须保留用户当前视角。
  useEffect(() => {
    const viewKey = `${document.id}:${focusRootId ?? 'all'}`
    if (!flowInstance || !baseNodes.length || fittedDocumentIdRef.current === viewKey) return
    let settleTimer = 0
    const frame = window.requestAnimationFrame(() => {
      const isMobile = window.matchMedia('(max-width: 620px)').matches
      // 手机上先让中心主题及其一级分支以可编辑的尺寸出现；完整导图仍可通过“适应视图”查看。
      const rootAndFirstBranches = baseNodes.filter((node) => node.id === document.rootId || document.nodes[node.id]?.parentId === document.rootId)
      const options = {
        nodes: isMobile && rootAndFirstBranches.length ? rootAndFirstBranches : baseNodes,
        padding: isMobile ? .28 : fitViewPadding(),
        maxZoom: isMobile ? .85 : 1,
      }
      flowInstance.fitView(options)
      // 移动端首次布局期间 React Flow 可能尚未完成容器测量，延后一帧再适配一次，
      // 避免初始导图落在手机视口外或缩放得无法阅读。
      if (isMobile) settleTimer = window.setTimeout(() => flowInstance.fitView(options), 120)
      fittedDocumentIdRef.current = viewKey
    })
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(settleTimer) }
  }, [baseNodes, document.id, flowInstance, focusRootId])

  useEffect(() => {
    if (!focusRequestNodeId) return
    const node = baseNodes.find((item) => item.id === focusRequestNodeId)
    if (!node || !flowInstance) return
    flowInstance.fitView({ nodes: [node], padding: 1.15, maxZoom: 1.15, duration: 260 })
    clearNodeFocusRequest()
  }, [baseNodes, clearNodeFocusRequest, flowInstance, focusRequestNodeId])

  const focusRoot = useCallback(() => {
    const rootNode = baseNodes.find((node) => node.id === viewDocument.rootId)
    selectNode(viewDocument.rootId)
    if (rootNode) flowInstance?.fitView({ nodes: [rootNode], padding: 1.5, maxZoom: 1.05, duration: 280 })
  }, [baseNodes, flowInstance, selectNode, viewDocument.rootId])

  const revealSearchResult = useCallback((documentId: string, nodeId: string) => {
    if (documentId === document.id && focusRootId && !viewDocument.nodes[nodeId]) {
      onRevealWorkspaceNode(documentId, nodeId)
      setSearchOpen(false)
      return
    }
    if (documentId !== document.id) {
      onRevealWorkspaceNode(documentId, nodeId)
      setSearchOpen(false)
      return
    }
    if (dispatch({ type: 'REVEAL_NODE', nodeId })) setSearchFocusNodeId(nodeId)
    setSearchOpen(false)
  }, [dispatch, document.id, focusRootId, onRevealWorkspaceNode, viewDocument.nodes])

  useEffect(() => {
    if (!searchOpen) return
    void listAllDepositProvenance().then(setSearchProvenance).catch(() => setSearchProvenance([]))
  }, [searchOpen])

  useEffect(() => {
    if (!searchFocusNodeId) return
    const node = baseNodes.find((item) => item.id === searchFocusNodeId)
    if (!node || !flowInstance) return
    flowInstance.fitView({ nodes: [node], padding: 1.15, maxZoom: 1.15, duration: 260 })
    setSearchFocusNodeId(null)
  }, [baseNodes, flowInstance, searchFocusNodeId])

  const cancelRelationCreation = useCallback(() => {
    setRelationSourceIds([])
    setRelationPointer(null)
  }, [])

  // 顶部、右键菜单和命令面板只发出“开始关系”意图。
  // 此时不写入任何节点；等待用户单击已有节点或双击画布后再原子提交。
  useEffect(() => {
    if (!relationCreationRequestSourceIds.length) return
    const sourceIds = [...new Set(relationCreationRequestSourceIds)].filter((sourceId) => Boolean(document.nodes[sourceId]))
    if (sourceIds.length) {
      setRelationSourceIds(sourceIds)
      setRelationPointer(null)
    }
    clearRelationCreationRequest()
  }, [clearRelationCreationRequest, document.nodes, relationCreationRequestSourceIds])

  const onReconnect = useCallback((edge: Edge, connection: Connection) => {
    const relation = document.relations.find((item) => item.id === edge.id)
    if (!relation || !connection.target || connection.target === relation.sourceId) return
    dispatch({ type: 'RETARGET_RELATION', relationId: relation.id, targetId: connection.target })
  }, [dispatch, document.relations])

  const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
    if (relationSourceIds.length) {
      const sourceIds = relationSourceIds.filter((sourceId) => sourceId !== node.id)
      if (sourceIds.length && dispatch({ type: 'CREATE_RELATIONS', sourceIds, targetId: node.id })) cancelRelationCreation()
      return
    }
    selectNode(node.id, event.metaKey || event.ctrlKey)
  }, [cancelRelationCreation, dispatch, relationSourceIds, selectNode])

  const relationDraftPaths = useMemo(() => {
    if (!relationPointer) return []
    return relationSourceIds.flatMap((sourceId) => {
      const source = basePositionsById.get(sourceId)
      return source ? [{ sourceId, ...relationDraftGeometry(source, relationPointer) }] : []
    })
  }, [basePositionsById, relationPointer, relationSourceIds])
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
      if (candidate.id === dragged.id || wouldCreateCycle(candidate.id)) return false
      const size = renderedSize(candidate)
      // 卡片四周保留一圈吸附热区，不要求鼠标必须压到节点中心。
      const horizontalPadding = 30
      const verticalPadding = 20
      return point.x >= candidate.position.x - horizontalPadding && point.x <= candidate.position.x + size.width + horizontalPadding
        && point.y >= candidate.position.y - verticalPadding && point.y <= candidate.position.y + size.height + verticalPadding
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

  const clearStableDropIntent = useCallback(() => {
    dropIntentRef.current = null
    pendingDropIntentRef.current = null
    setDropIntent(null)
    setDragPreview(null)
  }, [])

  // 指针在卡片边缘来回经过时，要求连续命中后才切换落点；离开也保留数帧，避免预览闪烁。
  const stabilizeDropIntent = useCallback((nodeId: string, next: DropIntent | null) => {
    const pending = pendingDropIntentRef.current
    const candidate = pending && sameDropIntent(pending.intent, next)
      ? { intent: pending.intent, count: pending.count + 1 }
      : { intent: next, count: 1 }
    pendingDropIntentRef.current = candidate
    const threshold = next ? 2 : 3
    if (candidate.count < threshold || sameDropIntent(dropIntentRef.current, next)) return
    dropIntentRef.current = next
    setDropIntent(next)
    const currentParentId = document.nodes[nodeId]?.parentId
    const preview = next?.kind === 'sibling' && next.parentId === currentParentId ? { nodeId, intent: next } : null
    setDragPreview(preview)
  }, [document.nodes])

  // onNodesChange：拖动分支根时同步平移其可见后代；拖中心主题仍平移整张导图。
  const onNodesChange: OnNodesChange<Node<MindNodeData>> = useCallback((changes) => {
    setFlowNodes((current) => {
      const branchMove = changes.find((change): change is NodePositionChange => (
        change.type === 'position' && change.position !== undefined && Boolean(document.nodes[change.id]?.childIds.length)
      ))
      if (!branchMove?.position) return applyNodeChanges(changes, current)

      const subtreeIds = branchMove.id === document.rootId
        ? new Set(Object.keys(document.nodes))
        : (() => {
          const ids = new Set<string>()
          const visit = (nodeId: string) => {
            ids.add(nodeId)
            document.nodes[nodeId]?.childIds.forEach(visit)
          }
          visit(branchMove.id)
          return ids
        })()
      const translated = translateDraggedSubtree(current, branchMove.id, branchMove.position, subtreeIds)
      return applyNodeChanges(changes.filter((change) => change !== branchMove), translated)
    })
  }, [document.nodes, document.rootId])
  // 普通树节点靠近原树时只会重排或调整层级；拖离所有树目标后，整支转为独立主题树。
  const onNodeDragStop: OnNodeDrag<Node<MindNodeData>> = useCallback((_event, node) => {
    setDraggingNodeId(null)
    setDetachingNodeId(null)
    setFreeTopicAttachmentParentId(null)
    activeDragNodeIdRef.current = null
    clearStableDropIntent()
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
    const structuralIntent = dropIntentNearTree(node)
    if (offset && shouldDetachTreeBranch({ offset, nearbyTreeIntent: structuralIntent })) {
      const detached = dispatch({ type: 'DETACH_AS_FREE_TOPIC', nodeId: node.id, x: node.position.x, y: node.position.y })
      if (!detached) setFlowNodes(baseNodes)
      return
    }
    const intent = resolveRegularTreeDragIntent({
      shiftKey: false,
      siblingIntent: siblingReorderIntent(node),
      structuralIntent,
    })
    if (intent) {
      const moved = dispatch({ type: 'MOVE_NODE', nodeId: node.id, newParentId: intent.parentId, index: intent.index })
      if (!moved) setFlowNodes(baseNodes)
      return
    }
    setFlowNodes(baseNodes)
  }, [attachmentParentNearBranch, baseNodes, clearStableDropIntent, dispatch, document.nodes, dropIntentNearTree, freeTopicAttachmentParentId, getDragOffset, siblingReorderIntent])
  const onNodeDrag: OnNodeDrag<Node<MindNodeData>> = useCallback((_event, node) => {
    if (activeDragNodeIdRef.current !== node.id) {
      activeDragNodeIdRef.current = node.id
      clearStableDropIntent()
    }
    setDraggingNodeId((current) => current === node.id ? current : node.id)
    if (document.nodes[node.id]?.isFreeTopic) {
      setDetachingNodeId(null)
      clearStableDropIntent()
      setFreeTopicAttachmentParentId((current) => {
        const next = attachmentParentNearBranch(node, current)
        return current === next ? current : next
      })
      setDragPreview(null)
      return
    }
    const offset = getDragOffset(node)
    const structuralIntent = dropIntentNearTree(node)
    if (offset && shouldDetachTreeBranch({ offset, nearbyTreeIntent: structuralIntent })) {
      setDetachingNodeId((current) => current === node.id ? current : node.id)
      clearStableDropIntent()
      return
    }
    setDetachingNodeId(null)
    const next = resolveRegularTreeDragIntent({
      shiftKey: false,
      siblingIntent: siblingReorderIntent(node),
      structuralIntent,
    })
    stabilizeDropIntent(node.id, next)
  }, [attachmentParentNearBranch, clearStableDropIntent, document.nodes, dropIntentNearTree, getDragOffset, siblingReorderIntent, stabilizeDropIntent])
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

  const selectBranch = useCallback((nodeId: string) => {
    setSelectedNodes(collectSubtreeNodeIds(document, nodeId).filter((id) => viewDocument.nodes[id]))
  }, [document, setSelectedNodes, viewDocument.nodes])

  const selectSiblings = useCallback((nodeId: string) => {
    const node = document.nodes[nodeId]
    if (!node?.parentId) {
      setSelectedNodes([nodeId])
      return
    }
    setSelectedNodes(document.nodes[node.parentId].childIds.filter((id) => viewDocument.nodes[id]))
  }, [document.nodes, setSelectedNodes, viewDocument.nodes])

  const selectAllVisible = useCallback(() => {
    setSelectedNodes(baseNodes.map((node) => node.id))
  }, [baseNodes, setSelectedNodes])

  const toggleBranchFocus = useCallback((nodeId: string) => {
    if (!onChangeFocusRoot || nodeId === document.rootId || document.nodes[nodeId]?.isFreeTopic) return
    onChangeFocusRoot(focusRootId === nodeId ? null : nodeId)
  }, [document.nodes, document.rootId, focusRootId, onChangeFocusRoot])

  const selectionToolbar = useMemo(() => {
    if (selectedNodeIds.length < 2) return null
    const nodes = selectedNodeIds.map((id) => basePositionsById.get(id)).filter((node): node is NonNullable<typeof node> => Boolean(node))
    if (nodes.length < 2) return null
    const left = (Math.min(...nodes.map((node) => node.x)) + Math.max(...nodes.map((node) => node.x + node.width))) / 2
    const top = Math.min(...nodes.map((node) => node.y)) - 38
    return { left, top, count: nodes.length }
  }, [basePositionsById, selectedNodeIds])

  const dropGuide = useMemo(() => {
    if (dropIntent?.kind !== 'sibling' || !draggingNodeId) return null
    const parent = document.nodes[dropIntent.parentId]
    if (!parent) return null
    const originalIndex = parent.childIds.indexOf(draggingNodeId)
    const siblingIds = parent.childIds.filter((id) => id !== draggingNodeId && basePositionsById.has(id))
    const adjustedIndex = Math.max(0, Math.min(
      dropIntent.index - (originalIndex >= 0 && originalIndex < dropIntent.index ? 1 : 0),
      siblingIds.length,
    ))
    const before = adjustedIndex > 0 ? basePositionsById.get(siblingIds[adjustedIndex - 1]) : null
    const after = adjustedIndex < siblingIds.length ? basePositionsById.get(siblingIds[adjustedIndex]) : null
    const anchor = after ?? before
    if (!anchor) return null
    const siblingGap = document.layout.siblingGap
    const top = after
      ? (before ? (before.y + before.height + after.y) / 2 : after.y - siblingGap / 2)
      : anchor.y + anchor.height + siblingGap / 2
    return { left: anchor.x - 14, top, width: anchor.width + 28 }
  }, [basePositionsById, document.layout.siblingGap, document.nodes, draggingNodeId, dropIntent])

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
      if (relationSourceIds.length && event.key === 'Escape') { event.preventDefault(); cancelRelationCreation(); return }
      if (meta && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandPaletteOpen(true); return }
      if (meta && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchOpen(true); return }
      if (target.closest('input, textarea, [contenteditable="true"]')) return
      const editor = useEditorStore.getState()
      const selected = editor.selectedNodeId ?? editor.document.rootId
      if (editingNodeId || commandPaletteOpen) return
      if (meta && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if (meta && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAllVisible(); return }
      if (meta && event.key.toLowerCase() === 'c') { event.preventDefault(); copyNode(selected); return }
      if (meta && event.key.toLowerCase() === 'x') { event.preventDefault(); cutNode(selected); return }
      if (meta && event.key.toLowerCase() === 'd') { event.preventDefault(); dispatch({ type: 'DUPLICATE_NODE', nodeId: selected }); return }
      if (meta && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        const sourceIds = editor.selectedNodeIds.length ? editor.selectedNodeIds : [selected]
        setRelationSourceIds(sourceIds)
        setRelationPointer(null)
        return
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        if (canCreateBoundary) dispatch({ type: 'CREATE_BOUNDARY', nodeIds: editor.selectedNodeIds })
        else showInteractionStatus('请先选择两个或以上同级节点')
        return
      }
      if (meta && event.key.toLowerCase() === 'r') { event.preventDefault(); focusRoot(); return }
      if (meta && event.key === ';') { event.preventDefault(); toggleBranchFocus(selected); return }
      if (meta && event.code === 'Slash') {
        event.preventDefault()
        dispatch({ type: event.shiftKey ? 'COLLAPSE_DESCENDANTS' : 'TOGGLE_COLLAPSE', nodeId: selected })
        return
      }
      if (meta && (event.key === '=' || event.key === '+')) { event.preventDefault(); void flowInstance?.zoomIn({ duration: 140 }); return }
      if (meta && event.key === '-') { event.preventDefault(); void flowInstance?.zoomOut({ duration: 140 }); return }
      if (meta && event.key === '0') { event.preventDefault(); void flowInstance?.zoomTo(1, { duration: 160 }); return }
      // 粘贴要等 ClipboardEvent 才能分辨图片还是内部复制的节点分支。
      if (meta && event.key.toLowerCase() === 'v') return
      if (event.key === 'Enter') {
        event.preventDefault()
        const selectedNode = editor.document.nodes[selected]
        if (selectedNode?.isFreeTopic) {
          showInteractionStatus('自由主题请先附加到主节点，再继续创建子节点')
          return
        }
        if (meta) {
          if (selected === editor.document.rootId) showInteractionStatus('中心主题不能再插入父节点')
          else dispatch({ type: 'ADD_PARENT', nodeId: selected })
          return
        }
        dispatch(selected === editor.document.rootId || selected === focusRootId
          ? { type: 'ADD_CHILD', parentId: selected }
          : { type: 'ADD_SIBLING', nodeId: selected, placement: event.shiftKey ? 'before' : 'after' })
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        if (event.shiftKey) dispatch({ type: 'OUTDENT_NODE', nodeId: selected })
        else if (editor.document.nodes[selected]?.isFreeTopic) showInteractionStatus('自由主题请先附加到主节点，再继续创建子节点')
        else dispatch({ type: 'ADD_CHILD', parentId: selected })
        return
      }
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
        if (meta && selected !== editor.document.rootId) {
          dispatch({ type: 'DELETE_SINGLE_NODE', nodeId: selected })
          return
        }
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
        if (topLevelIds.length) dispatch({ type: 'DELETE_NODES', nodeIds: topLevelIds })
        return
      }
      if (event.key === ' ') { event.preventDefault(); editNode(selected); return }
      if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        const adjacent = adjacentNodeId(selected, event.key)
        if (adjacent && basePositionsById.has(adjacent)) selectNode(adjacent)
        return
      }
      if (event.key === 'F2') { event.preventDefault(); editNode(selected); return }
      if (!meta && !event.altKey && !event.isComposing && event.key.length === 1) {
        event.preventDefault()
        editNode(selected, event.key)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [basePositionsById, cancelRelationCreation, canCreateBoundary, commandPaletteOpen, copyNode, cutNode, dispatch, editNode, editingNodeId, flowInstance, focusRoot, focusRootId, pasteIntoNode, redo, relationSourceIds.length, selectAllVisible, selectNode, showInteractionStatus, toggleBranchFocus, undo])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return
      const image = findClipboardImageFile(event.clipboardData)
      const selected = useEditorStore.getState().selectedNodeId ?? document.rootId
      if (!image) {
        event.preventDefault()
        if (document.nodes[selected]?.isFreeTopic) {
          showInteractionStatus('自由主题请先附加到主节点，再粘贴子节点')
          return
        }
        pasteIntoNode(selected)
        return
      }
      event.preventDefault()
      if (image.size > 15 * 1024 * 1024) { setPasteAttachmentStatus('图片超过 15 MB，未添加。'); return }
      const file = new File([image], image.name || `粘贴图片-${Date.now()}.${image.type.split('/')[1] || 'png'}`, { type: image.type })
      void saveNodeAttachment(document.id, selected, file)
        .then((attachment) => {
          if (dispatch({ type: 'ADD_NODE_ATTACHMENT', nodeId: selected, attachment })) setPasteAttachmentStatus(`已添加图片：${attachment.name}`)
        })
        .catch(() => setPasteAttachmentStatus('图片保存失败，请重试。'))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [dispatch, document.id, document.nodes, document.rootId, pasteIntoNode, showInteractionStatus])

  return (
    <div className={`canvas-shell canvas-shell--detail-${semanticZoomLevel}`} style={{
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
      if (relationSourceIds.length && flowInstance) setRelationPointer(flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
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
      // 只处理真正的画布空白区；节点、关系线、摘要等元素的双击仍交给它们自身。
      if (!flowInstance || !target.classList.contains('react-flow__pane')) return
      if (relationSourceIds.length) {
        event.preventDefault()
        event.stopPropagation()
        const pointer = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        const position = relationTopicPositionAt(pointer)
        if (dispatch({ type: 'CREATE_RELATED_FREE_TOPIC', sourceIds: relationSourceIds, ...position })) cancelRelationCreation()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const position = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      dispatch({ type: 'ADD_FREE_TOPIC', x: position.x, y: position.y })
    }}>
      <ReactFlow
        nodes={renderedFlowNodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onInit={initializeFlow}
        onMove={onViewportMove}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onNodeDrag={onNodeDrag}
        // 仅在框选手势结束时读取内部选择，避免 React Flow 的 nodes 同步通知反向写回状态。
        onSelectionEnd={commitSelectionBox}
        onNodeContextMenu={(event, node) => openContextMenu(event.nativeEvent, node.id)}
        onPaneContextMenu={(event) => openContextMenu('nativeEvent' in event ? event.nativeEvent : event, null)}
        onEdgeClick={(event, edge) => { event.stopPropagation(); cancelRelationCreation(); selectRelation(edge.id) }}
        onEdgeDoubleClick={(event, edge) => {
          event.stopPropagation()
          cancelRelationCreation()
          selectRelation(edge.id)
        }}
        onReconnect={onReconnect}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault()
          cancelRelationCreation()
          selectRelation(edge.id)
          setContextMenu({ position: { x: event.clientX, y: event.clientY }, nodeId: null, relationId: edge.id })
        }}
        onPaneClick={() => { if (!relationSourceIds.length) selectNode(null); closeContextMenu() }}
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
          {dropGuide && <div className="tree-drop-guide" style={{ left: dropGuide.left, top: dropGuide.top, width: dropGuide.width }} aria-hidden="true"><i /></div>}
          {relationDraftPaths.length > 0 && relationPointer && (
            <svg className="relation-draft-preview" aria-hidden="true">
              <defs>
                <marker id="relation-draft-arrow" viewBox="0 0 8 8" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M 0 0 L 8 4 L 0 8 z" />
                </marker>
              </defs>
              {relationDraftPaths.map((draft) => <path key={draft.sourceId} className="relation-draft-preview__line" d={draft.path} markerEnd="url(#relation-draft-arrow)" />)}
              <circle className="relation-draft-preview__target" cx={relationPointer.x} cy={relationPointer.y} r={4} />
            </svg>
          )}
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
        <Controls showInteractive={false} fitViewOptions={{ padding: fitViewPadding(), maxZoom: 1 }}>
          <ControlButton onClick={() => setSearchOpen(true)} title="搜索导图">⌕</ControlButton>
          <ControlButton onClick={focusRoot} title="前往中心主题">◎</ControlButton>
          <ControlButton
            className={`semantic-zoom-control ${semanticZoomEnabled ? 'is-active' : ''}`}
            onClick={toggleSemanticZoom}
            title={semanticZoomEnabled ? `语义缩放已开启 · 当前${semanticZoomLevelLabel[semanticZoomLevel]}层` : '语义缩放已关闭 · 始终显示完整节点'}
            aria-label={semanticZoomEnabled ? `关闭语义缩放，当前${semanticZoomLevelLabel[semanticZoomLevel]}层` : '开启语义缩放'}
            aria-pressed={semanticZoomEnabled}
          >层</ControlButton>
        </Controls>
      </ReactFlow>
      {relationSourceIds.length > 0 && <div className="relation-creation-hint" role="status"><strong>正在创建关系</strong><span>单击已有节点，或双击空白处创建新主题 · Esc 取消</span></div>}
      {freeTopicAttachmentParentId && <div className="free-topic-attach-hint" role="status">松开即可添加到高亮分支</div>}
      {detachingNodeId && <div className="tree-drop-hint" role="status">松开即可成为独立主题</div>}
      {dropIntent && <div className="tree-drop-hint" role="status">{dropIntent.kind === 'child' ? '松开即可成为该节点的子节点' : `松开即可插入此分支的第 ${dropIntent.index + 1} 个位置`}</div>}
      {pasteAttachmentStatus && <div className="paste-attachment-hint" role="status">{pasteAttachmentStatus}</div>}
      {interactionStatus && <div className="paste-attachment-hint" role="status">{interactionStatus}</div>}
      {searchOpen && <NodeSearchDialog currentDocumentId={document.id} documents={[document, ...workspaceDocuments.filter((item) => item.id !== document.id)]} tags={tags} provenance={searchProvenance} onClose={() => setSearchOpen(false)} onSelect={revealSearchResult} onCreate={(topic) => { const selected = selectedNodeId ? document.nodes[selectedNodeId] : null; const parentId = selected && !selected.isFreeTopic ? selected.id : document.rootId; if (dispatch({ type: 'ADD_CHILD', parentId, topic })) setSearchOpen(false) }} />}
      {contextMenu && (() => {
        const contextNode = contextMenu.nodeId ? document.nodes[contextMenu.nodeId] : null
        const contextRelation = contextMenu.relationId ? document.relations.find((relation) => relation.id === contextMenu.relationId) ?? null : null
        const targetNodeId = contextNode?.id ?? document.rootId
        return (
          <ContextMenu
            position={contextMenu.position}
            node={contextNode}
            relation={contextRelation}
            isRoot={targetNodeId === document.rootId || targetNodeId === focusRootId}
            onAddChild={() => runContextAction(() => dispatch({ type: 'ADD_CHILD', parentId: targetNodeId }))}
            onAddSibling={() => runContextAction(() => dispatch({ type: 'ADD_SIBLING', nodeId: targetNodeId }))}
            onAddSiblingBefore={() => runContextAction(() => dispatch({ type: 'ADD_SIBLING', nodeId: targetNodeId, placement: 'before' }))}
            onAddParent={() => runContextAction(() => dispatch({ type: 'ADD_PARENT', nodeId: targetNodeId }))}
            onDuplicate={() => runContextAction(() => dispatch({ type: 'DUPLICATE_NODE', nodeId: targetNodeId }))}
            onAddFreeTopic={() => runContextAction(() => {
              const position = flowInstance?.screenToFlowPosition(contextMenu.position)
              if (position) dispatch({ type: 'ADD_FREE_TOPIC', x: position.x, y: position.y })
            })}
            onAttachToRoot={() => runContextAction(() => dispatch({ type: 'ATTACH_FREE_TOPIC', nodeId: targetNodeId, parentId: document.rootId }))}
            onEdit={() => runContextAction(() => editNode(targetNodeId))}
            onToggleMark={(mark) => runContextAction(() => dispatch({ type: 'TOGGLE_NODE_MARK', nodeId: targetNodeId, mark }))}
            onCreateRelation={() => runContextAction(() => { selectNode(targetNodeId); setRelationSourceIds([targetNodeId]); setRelationPointer(null) })}
            onCreateBoundary={() => runContextAction(() => dispatch({ type: 'CREATE_BOUNDARY', nodeIds: selectedNodeIds }))}
            onCreateSummary={() => runContextAction(() => dispatch({ type: 'CREATE_SUMMARY', nodeIds: selectedNodeIds }))}
            onToggleCollapse={() => runContextAction(() => dispatch({ type: 'TOGGLE_COLLAPSE', nodeId: targetNodeId }))}
            onCollapseDescendants={() => runContextAction(() => dispatch({ type: 'COLLAPSE_DESCENDANTS', nodeId: targetNodeId }))}
            onExpandDescendants={() => runContextAction(() => dispatch({ type: 'EXPAND_DESCENDANTS', nodeId: targetNodeId }))}
            onFocusRoot={() => runContextAction(focusRoot)}
            onFocusBranch={() => runContextAction(() => toggleBranchFocus(targetNodeId))}
            onSelectBranch={() => runContextAction(() => selectBranch(targetNodeId))}
            onSelectSiblings={() => runContextAction(() => selectSiblings(targetNodeId))}
            onSelectAll={() => runContextAction(selectAllVisible)}
            onIndent={() => runContextAction(() => dispatch({ type: 'INDENT_NODE', nodeId: targetNodeId }))}
            onOutdent={() => runContextAction(() => dispatch({ type: 'OUTDENT_NODE', nodeId: targetNodeId }))}
            onCopy={() => runContextAction(() => copyNode(targetNodeId))}
            onCut={() => runContextAction(() => cutNode(targetNodeId))}
            onPaste={() => runContextAction(() => pasteIntoNode(targetNodeId))}
            onResetPosition={() => runContextAction(() => dispatch({ type: 'RESET_NODE_OFFSET', nodeId: targetNodeId }))}
            onAutoArrange={() => runContextAction(() => dispatch({ type: 'AUTO_ARRANGE' }))}
            onRestoreFreeform={() => runContextAction(() => dispatch({ type: 'RESTORE_FREEFORM_LAYOUT' }))}
            onDelete={() => runContextAction(() => dispatch({ type: 'DELETE_NODE', nodeId: targetNodeId }))}
            onDeleteSingle={() => runContextAction(() => dispatch({ type: 'DELETE_SINGLE_NODE', nodeId: targetNodeId }))}
            onResetRelationCurve={() => contextRelation && runContextAction(() => dispatch({ type: 'UPDATE_RELATION_STYLE', relationId: contextRelation.id, patch: { controlOffsetX: 0, controlOffsetY: 0 } }))}
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
              { label: '新建子节点', detail: '在当前节点下继续展开想法', shortcut: 'Tab', disabled: selected.isFreeTopic, run: () => dispatch({ type: 'ADD_CHILD', parentId: selectedId }) },
              { label: '在后方新建同级节点', detail: '在当前层级的下一位增加主题', shortcut: '↵', disabled: selectedId === document.rootId || selectedId === focusRootId || selected.isFreeTopic, run: () => dispatch({ type: 'ADD_SIBLING', nodeId: selectedId }) },
              { label: '在前方新建同级节点', detail: '在当前层级的上一位增加主题', shortcut: '⇧ ↵', disabled: selectedId === document.rootId || selectedId === focusRootId || selected.isFreeTopic, run: () => dispatch({ type: 'ADD_SIBLING', nodeId: selectedId, placement: 'before' }) },
              { label: '插入父节点', detail: '在当前节点与原父节点之间增加一层', shortcut: '⌘ ↵', disabled: selectedId === document.rootId || selected.isFreeTopic, run: () => dispatch({ type: 'ADD_PARENT', nodeId: selectedId }) },
              ...(selected.isFreeTopic ? [{ label: '附加到主节点', detail: '转为中心主题下的一级分支，并自动排列', shortcut: '—', run: () => dispatch({ type: 'ATTACH_FREE_TOPIC', nodeId: selectedId, parentId: document.rootId }) }] : []),
              { label: '编辑当前节点', detail: '修改节点主题文字', shortcut: 'F2', run: () => editNode(selectedId) },
              { label: '创建关系', detail: '连线跟随鼠标，单击已有节点或双击空白处', shortcut: '—', run: () => { selectNode(selectedId); setRelationSourceIds([selectedId]); setRelationPointer(null) } },
              { label: '为所选节点创建边界', detail: '圈定两个或以上同级节点，不改变树结构', shortcut: '—', disabled: !canCreateBoundary, run: () => dispatch({ type: 'CREATE_BOUNDARY', nodeIds: selectedNodeIds }) },
              { label: '为所选节点创建摘要', detail: '为同级分支写下一个结论，不改变树结构', shortcut: '—', disabled: !canCreateBoundary, run: () => dispatch({ type: 'CREATE_SUMMARY', nodeIds: selectedNodeIds }) },
              { label: selected.collapsed ? '展开当前分支' : '折叠当前分支', detail: '收起或展开子节点', shortcut: '⌘ /', disabled: !selected.childIds.length, run: () => dispatch({ type: 'TOGGLE_COLLAPSE', nodeId: selectedId }) },
              { label: '折叠所有次级分支', detail: '保留当前层级，收起更深的内容', shortcut: '—', disabled: !selected.childIds.length, run: () => dispatch({ type: 'COLLAPSE_DESCENDANTS', nodeId: selectedId }) },
              { label: '展开所有次级分支', detail: '展开当前分支下的全部内容', shortcut: '—', disabled: !selected.childIds.length, run: () => dispatch({ type: 'EXPAND_DESCENDANTS', nodeId: selectedId }) },
              { label: '前往中心主题', detail: '定位并聚焦根节点', shortcut: '◎', run: focusRoot },
              { label: focusRootId === selectedId ? '退出分支聚焦' : '仅显示当前分支', detail: '隐藏其他分支，专注当前主题', shortcut: '⌘ ;', disabled: selectedId === document.rootId || selected.isFreeTopic, run: () => toggleBranchFocus(selectedId) },
              { label: '选择当前分支', detail: '选中当前节点及其全部后代', shortcut: '—', run: () => selectBranch(selectedId) },
              { label: '选择同级节点', detail: '选中当前父节点下的所有主题', shortcut: '—', disabled: selectedId === document.rootId, run: () => selectSiblings(selectedId) },
              { label: '选择全部节点', detail: '选中当前画布中的全部可见主题', shortcut: '⌘ A', run: selectAllVisible },
              { label: '降低层级', detail: '变为前一个同级节点的子节点', shortcut: '⌥ →', disabled: selectedId === document.rootId || (document.nodes[selectedId].parentId !== null && document.nodes[document.nodes[selectedId].parentId].childIds.indexOf(selectedId) === 0), run: () => dispatch({ type: 'INDENT_NODE', nodeId: selectedId }) },
              { label: '提升层级', detail: '移动到父节点之后', shortcut: '⇧ Tab', disabled: selectedId === document.rootId || document.nodes[selectedId].parentId === document.rootId, run: () => dispatch({ type: 'OUTDENT_NODE', nodeId: selectedId }) },
              { label: '复制当前分支', detail: '复制节点及全部子节点', shortcut: '⌘ C', run: () => copyNode(selectedId) },
              { label: '复制一个副本', detail: '在当前节点后生成完整分支副本', shortcut: '⌘ D', disabled: selectedId === document.rootId, run: () => dispatch({ type: 'DUPLICATE_NODE', nodeId: selectedId }) },
              { label: '剪切当前分支', detail: '剪切节点及全部子节点', shortcut: '⌘ X', disabled: selectedId === document.rootId, run: () => cutNode(selectedId) },
              { label: '粘贴为子节点', detail: '将已复制分支粘贴到当前节点下', shortcut: '⌘ V', disabled: clipboard === null, run: () => pasteIntoNode(selectedId) },
              { label: '重置节点位置', detail: '移除人工微调，回到自动布局', shortcut: '—', run: () => dispatch({ type: 'RESET_NODE_OFFSET', nodeId: selectedId }) },
              { label: '仅删除当前节点', detail: '保留并提升其子节点', shortcut: '⌘ ⌫', disabled: selectedId === document.rootId || selected.isFreeTopic, run: () => dispatch({ type: 'DELETE_SINGLE_NODE', nodeId: selectedId }) },
              { label: '删除当前分支', detail: '删除节点及其全部子节点', shortcut: '⌫', disabled: selectedId === document.rootId, run: () => dispatch({ type: 'DELETE_NODE', nodeId: selectedId }) },
            ]}
          />
        )
      })()}
    </div>
  )
}
