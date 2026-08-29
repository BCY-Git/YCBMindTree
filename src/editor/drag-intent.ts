export type TreeDropIntent = { parentId: string; index: number; kind: 'child' | 'sibling' }
export type PendingTreeDropIntent = { intent: TreeDropIntent | null; since: number }

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

function sameTreeDropIntent(left: TreeDropIntent | null, right: TreeDropIntent | null) {
  return left?.parentId === right?.parentId && left?.index === right?.index && left?.kind === right?.kind
}

/**
 * 时间型滞回：进入或切换目标需稳定 100ms，离开当前目标需稳定 140ms。
 * 相比按 mousemove 次数计数，不会因触控板、鼠标或浏览器采样率不同而改变手感。
 */
export function stabilizeTreeDropIntent({
  current,
  pending,
  next,
  now,
}: {
  current: TreeDropIntent | null
  pending: PendingTreeDropIntent | null
  next: TreeDropIntent | null
  now: number
}) {
  if (sameTreeDropIntent(current, next)) return { current, pending: null }
  const nextPending = pending && sameTreeDropIntent(pending.intent, next) ? pending : { intent: next, since: now }
  const delay = next ? 100 : 140
  if (now - nextPending.since < delay) return { current, pending: nextPending }
  return { current: next, pending: null }
}
