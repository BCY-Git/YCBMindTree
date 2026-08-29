import type { TreeDropIntent } from './drag-intent'

export type DragRect = { x: number; y: number; width: number; height: number }
export type DragMotion = { x: number; y: number }
export type ScoredTreeDropCandidate = TreeDropIntent & { score: number }

type ChildCandidateInput = {
  parentId: string
  index: number
  target: DragRect
  dragged: DragRect
  motion: DragMotion
  hotZoneMultiplier?: number
  retained?: boolean
}

type SiblingCandidateInput = {
  parentId: string
  index: number
  branchStart: { x: number; y: number }
  branchEnd: { x: number; y: number }
  dragged: DragRect
  hotZoneMultiplier?: number
  retained?: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function center(rect: DragRect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function distanceToRect(point: { x: number; y: number }, rect: DragRect) {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width))
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}

function distanceToSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y)
  const ratio = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1)
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy))
}

function overlapRatio(first: DragRect, second: DragRect) {
  const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x))
  const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y))
  return width * height / Math.max(1, first.width * first.height)
}

function directionalAlignment(from: DragRect, to: DragRect, motion: DragMotion) {
  const motionLength = Math.hypot(motion.x, motion.y)
  if (motionLength < 12) return 0
  const fromCenter = center(from)
  const toCenter = center(to)
  const targetX = toCenter.x - fromCenter.x
  const targetY = toCenter.y - fromCenter.y
  const targetLength = Math.hypot(targetX, targetY)
  if (!targetLength) return 0
  return (motion.x * targetX + motion.y * targetY) / (motionLength * targetLength)
}

/**
 * 节点落点采用「实际距离 + 卡片重叠 + 拖动方向」综合评分。
 * 热区随两张卡片尺寸扩展，避免长文本或大卡片仍沿用小节点的固定像素阈值。
 */
export function scoreChildDropCandidate(input: ChildCandidateInput): ScoredTreeDropCandidate | null {
  const point = center(input.dragged)
  const multiplier = input.hotZoneMultiplier ?? 1
  const paddingX = clamp((input.target.width + input.dragged.width) * .28 * multiplier, 36, 180)
  const paddingY = clamp((input.target.height + input.dragged.height) * .30 * multiplier, 24, 112)
  const expandedTarget: DragRect = {
    x: input.target.x - paddingX,
    y: input.target.y - paddingY,
    width: input.target.width + paddingX * 2,
    height: input.target.height + paddingY * 2,
  }
  const expandedDistance = distanceToRect(point, expandedTarget)
  if (expandedDistance > 0) return null

  const actualDistance = distanceToRect(point, input.target)
  const score = actualDistance * .45 - overlapRatio(input.dragged, input.target) * 92 - directionalAlignment(input.dragged, input.target, input.motion) * 18 - (input.retained ? 14 : 0)
  return { parentId: input.parentId, index: input.index, kind: 'child', score }
}

/** 树枝插入槽位的命中范围同样随被拖节点尺寸放大。 */
export function scoreSiblingDropCandidate(input: SiblingCandidateInput): ScoredTreeDropCandidate | null {
  const point = center(input.dragged)
  const distance = distanceToSegment(point, input.branchStart, input.branchEnd)
  const threshold = clamp((38 + input.dragged.height * .35) * (input.hotZoneMultiplier ?? 1), 48, 180)
  if (distance > threshold) return null
  // 同一距离下，直接压在卡片上的 child 候选会因较低的基础分优先。
  return { parentId: input.parentId, index: input.index, kind: 'sibling', score: 26 + distance * 1.1 - (input.retained ? 14 : 0) }
}

export function chooseBestTreeDropCandidate(candidates: Array<ScoredTreeDropCandidate | null>, current: TreeDropIntent | null = null): ScoredTreeDropCandidate | null {
  return candidates
    .filter((candidate): candidate is ScoredTreeDropCandidate => candidate !== null)
    .map((candidate) => ({
      ...candidate,
      // 保持当前候选有轻微奖励，减少两个等价目标之间的跳动。
      score: candidate.score - (current?.parentId === candidate.parentId && current.index === candidate.index && current.kind === candidate.kind ? 14 : 0),
    }))
    .sort((left, right) => left.score - right.score || (left.kind === right.kind ? 0 : left.kind === 'child' ? -1 : 1) || left.parentId.localeCompare(right.parentId) || left.index - right.index)[0] ?? null
}

/** 自由主题也复用同一套评分，只保留“最适合附着的父节点”。 */
export function chooseBestAttachmentParent(candidates: Array<ScoredTreeDropCandidate | null>, retainedParentId: string | null = null): string | null {
  const current = retainedParentId ? { parentId: retainedParentId, index: 0, kind: 'child' as const } : null
  return chooseBestTreeDropCandidate(candidates, current)?.parentId ?? null
}
