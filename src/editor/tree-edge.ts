/**
 * 树边连接器 — 决定节点之间连接线的锚点（左/右侧 Handle）。
 *
 * React Flow 要求每个节点有 source 和 target 两个方向的 Handle。
 * 由于节点支持自由偏移，子节点可能被拖到父节点左侧。
 * 本模块根据子节点相对父节点的 x 坐标，判断是否翻转连接线方向，
 * 避免连接线在画布上产生绕回/交叉的视觉效果。
 *
 * 规则：
 * - 子节点 x > 父节点中心 x：子节点在右侧 → source-right → target-left（默认右向）
 * - 子节点 x < 父节点中心 x：子节点在左侧 → source-left → target-right（翻转）
 */
import type { PositionedNode } from '@/layout/tree-layout'
import type { MindMapDocument } from '@/domain/document.types'

export type TreeEdgeAnchors = {
  sourceHandle: 'source-left' | 'source-right'
  targetHandle: 'target-left' | 'target-right'
}

export function getTreeEdgeAnchors(parent: PositionedNode, child: PositionedNode): TreeEdgeAnchors {
  const parentCenterX = parent.x + parent.width / 2
  const childCenterX = child.x + child.width / 2
  return childCenterX < parentCenterX
    ? { sourceHandle: 'source-left', targetHandle: 'target-right' }
    : { sourceHandle: 'source-right', targetHandle: 'target-left' }
}

export type MindTreePathInput = {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  /** 为兼容现有边数据保留；XMind 风格中所有层级使用同一几何规则。 */
  fromRoot: boolean
}

/**
 * XMind 风格的规则圆角折线：先从父节点水平伸出到统一分叉轴，再垂直转向子节点。
 * 转角半径固定上限且只受可用空间约束，因此上下分支严格镜像，不会因距离不同产生
 * 随机观感的贝塞尔弧度。
 */
export function getMindTreePath({ sourceX, sourceY, targetX, targetY }: MindTreePathInput) {
  const round = (value: number) => Math.round(value * 1000) / 1000
  const direction = targetX >= sourceX ? 1 : -1
  const distance = Math.abs(targetX - sourceX)
  const verticalDistance = Math.abs(targetY - sourceY)
  if (verticalDistance < .5) return `M ${round(sourceX)} ${round(sourceY)} L ${round(targetX)} ${round(targetY)}`

  const branchDistance = Math.min(48, Math.max(24, distance * .42))
  const branchX = sourceX + branchDistance * direction
  const verticalDirection = targetY >= sourceY ? 1 : -1
  const radius = Math.min(12, verticalDistance / 2, Math.max(0, distance - branchDistance) / 2)
  const beforeFirstCornerX = branchX - radius * direction
  const afterSecondCornerX = branchX + radius * direction
  const afterFirstCornerY = sourceY + radius * verticalDirection
  const beforeSecondCornerY = targetY - radius * verticalDirection

  return `M ${round(sourceX)} ${round(sourceY)} H ${round(beforeFirstCornerX)} Q ${round(branchX)} ${round(sourceY)} ${round(branchX)} ${round(afterFirstCornerY)} V ${round(beforeSecondCornerY)} Q ${round(branchX)} ${round(targetY)} ${round(afterSecondCornerX)} ${round(targetY)} H ${round(targetX)}`
}

/**
 * Drawnix 的颜色跟随一级分支，而不是跟随节点深度。
 * 因而同一主分支上的所有后代节点和连线始终保持同色。
 */
export function getTreeBranchColor(
  document: Pick<MindMapDocument, 'nodes' | 'rootId'>,
  nodeId: string,
  palette: readonly string[],
  fallback: string,
) {
  if (!palette.length || nodeId === document.rootId) return fallback
  let branch = document.nodes[nodeId]
  if (!branch) return fallback
  while (branch.parentId && branch.parentId !== document.rootId) {
    const parent = document.nodes[branch.parentId]
    if (!parent) return fallback
    branch = parent
  }
  if (branch.parentId !== document.rootId) return fallback
  const root = document.nodes[document.rootId]
  const branchIndex = root?.childIds.indexOf(branch.id) ?? -1
  return branchIndex >= 0 ? palette[branchIndex % palette.length] : fallback
}
