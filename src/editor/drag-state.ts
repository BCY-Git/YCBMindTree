type FlowNodeWithPosition = {
  id: string
  position: { x: number; y: number }
  dragging?: boolean
}

/** 画布拖动一棵树的根时，让当前可见后代保持相对位置一起移动。 */
export function translateDraggedSubtree<T extends FlowNodeWithPosition>(
  nodes: readonly T[],
  rootId: string,
  nextRootPosition: { x: number; y: number },
  subtreeIds: ReadonlySet<string>,
): T[] {
  const root = nodes.find((node) => node.id === rootId)
  if (!root) return [...nodes]
  const deltaX = nextRootPosition.x - root.position.x
  const deltaY = nextRootPosition.y - root.position.y
  return nodes.map((node) => {
    if (node.id === rootId) return { ...node, position: nextRootPosition }
    return subtreeIds.has(node.id)
      ? { ...node, position: { x: node.position.x + deltaX, y: node.position.y + deltaY } }
      : node
  })
}

/**
 * 布局或吸附高亮会重新生成节点数组。拖拽尚未结束时，必须保留手指/鼠标正在
 * 控制的节点坐标，否则它会被自动布局瞬间拉回，形成闪烁。
 */
export function retainDraggingNodePosition<T extends FlowNodeWithPosition>(
  baseNodes: readonly T[],
  currentNodes: readonly T[],
  draggingNodeId: string | null,
  draggedSubtreeIds: ReadonlySet<string> = new Set(),
): T[] {
  if (!draggingNodeId) return [...baseNodes]
  const dragged = currentNodes.find((node) => node.id === draggingNodeId)
  const baseRoot = baseNodes.find((node) => node.id === draggingNodeId)
  if (!dragged || !baseRoot) return [...baseNodes]
  const deltaX = dragged.position.x - baseRoot.position.x
  const deltaY = dragged.position.y - baseRoot.position.y
  return baseNodes.map((node) => {
    if (node.id === draggingNodeId) return { ...node, position: dragged.position, dragging: dragged.dragging }
    return draggedSubtreeIds.has(node.id)
      ? { ...node, position: { x: node.position.x + deltaX, y: node.position.y + deltaY } }
      : node
  })
}
