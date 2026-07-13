type FlowNodeWithPosition = {
  id: string
  position: { x: number; y: number }
  dragging?: boolean
}

/**
 * 布局或吸附高亮会重新生成节点数组。拖拽尚未结束时，必须保留手指/鼠标正在
 * 控制的节点坐标，否则它会被自动布局瞬间拉回，形成闪烁。
 */
export function retainDraggingNodePosition<T extends FlowNodeWithPosition>(baseNodes: readonly T[], currentNodes: readonly T[], draggingNodeId: string | null): T[] {
  if (!draggingNodeId) return [...baseNodes]
  const dragged = currentNodes.find((node) => node.id === draggingNodeId)
  if (!dragged) return [...baseNodes]
  return baseNodes.map((node) => node.id === draggingNodeId
    ? { ...node, position: dragged.position, dragging: dragged.dragging }
    : node)
}
