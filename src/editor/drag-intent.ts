export type TreeDropIntent = { parentId: string; index: number; kind: 'child' | 'sibling' }

const TREE_BRANCH_DETACH_DISTANCE = 160

export function shouldDetachTreeBranch({
  offset,
  nearbyTreeIntent,
}: {
  offset: { x: number; y: number }
  nearbyTreeIntent: TreeDropIntent | null
}) {
  return nearbyTreeIntent === null && Math.hypot(offset.x, offset.y) >= TREE_BRANCH_DETACH_DISTANCE
}

/**
 * 常规节点遵循 XMind 一类导图工具的直接拖放语义：明确落在节点卡片上时改为
 * 该节点的子节点，落在同级插入区时调整顺序。Shift 保留兼容，但不再是改层级的门槛。
 */
export function resolveRegularTreeDragIntent({
  shiftKey,
  siblingIntent,
  structuralIntent,
}: {
  shiftKey: boolean
  siblingIntent: TreeDropIntent | null
  structuralIntent: TreeDropIntent | null
}): TreeDropIntent | null {
  void shiftKey
  return structuralIntent ?? siblingIntent
}
