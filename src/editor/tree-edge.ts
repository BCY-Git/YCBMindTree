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

export function getTreeEdgeAnchors(parent: PositionedNode, child: PositionedNode): TreeEdgeAnchors {
  const parentCenterX = parent.x + parent.width / 2
  const childCenterX = child.x + child.width / 2
  return childCenterX < parentCenterX
    ? { sourceHandle: 'source-left', targetHandle: 'target-right' }
    : { sourceHandle: 'source-right', targetHandle: 'target-left' }
}
