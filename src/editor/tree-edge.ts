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
import type { PositionedNode } from '../layout/tree-layout'

export type TreeEdgeAnchors = {
  sourceHandle: 'source-left' | 'source-right'
  targetHandle: 'target-left' | 'target-right'
}

export type TreeBranchGeometry = TreeEdgeAnchors & {
  direction: 'left' | 'right'
  junctionX: number
  junctionOffset: number
}

export function getTreeEdgeAnchors(parent: PositionedNode, child: PositionedNode): TreeEdgeAnchors {
  const parentCenterX = parent.x + parent.width / 2
  const childCenterX = child.x + child.width / 2
  return childCenterX < parentCenterX
    ? { sourceHandle: 'source-left', targetHandle: 'target-right' }
    : { sourceHandle: 'source-right', targetHandle: 'target-left' }
}

/**
 * 为同一父节点同一侧的所有子节点计算共享交叉点。
 * 交叉点位于父节点边缘和最近子节点边缘的中间；因此即使单个子节点被横向拖动，
 * 兄弟分支仍共享一根稳定的纵向主干，不会重新退化成扇形尖点。
 */
export function getTreeBranchGeometry(parent: PositionedNode, child: PositionedNode, siblings: PositionedNode[]): TreeBranchGeometry {
  const anchors = getTreeEdgeAnchors(parent, child)
  const direction = anchors.sourceHandle === 'source-right' ? 'right' : 'left'
  const sameSide = siblings.filter((sibling) => getTreeEdgeAnchors(parent, sibling).sourceHandle === anchors.sourceHandle)
  const sourceEdgeX = direction === 'right' ? parent.x + parent.width : parent.x
  const nearestTargetX = direction === 'right'
    ? Math.min(...sameSide.map((sibling) => sibling.x))
    : Math.max(...sameSide.map((sibling) => sibling.x + sibling.width))
  const junctionX = (sourceEdgeX + nearestTargetX) / 2
  return { ...anchors, direction, junctionX, junctionOffset: Math.abs(junctionX - sourceEdgeX) }
}

export function getTreeBranchPath({ sourceX, sourceY, junctionX, targetX, targetY }: {
  sourceX: number
  sourceY: number
  junctionX: number
  targetX: number
  targetY: number
}) {
  return `M ${sourceX} ${sourceY} H ${junctionX} V ${targetY} H ${targetX}`
}
