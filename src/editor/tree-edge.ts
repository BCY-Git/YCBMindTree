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
  /** Drawnix/Plait 的中心主题直接进入曲线；普通节点会先伸出一小段树枝。 */
  fromRoot: boolean
}

/**
 * 复刻 Drawnix 底层 Plait mind 的 logic-link 轮廓：
 * 普通父节点先延伸 8px，再用非对称三次贝塞尔曲线连接到子节点。
 * 这里直接输出 SVG path，以便继续沿用 React Flow 的锚点、拖拽和缩放能力。
 */
export function getMindTreePath({ sourceX, sourceY, targetX, targetY, fromRoot }: MindTreePathInput) {
  const round = (value: number) => Math.round(value * 1000) / 1000
  const direction = targetX >= sourceX ? 1 : -1
  const distance = Math.abs(targetX - sourceX)
  const stemLength = fromRoot ? 0 : Math.min(8, distance * .16)
  const curveStartX = round(sourceX + stemLength * direction)
  const curveDistance = Math.max(0, Math.abs(targetX - curveStartX))
  const control1X = round(curveStartX + (curveDistance / 3) * direction)
  const control2X = round(targetX - (curveDistance / 2.4) * direction)
  const stem = stemLength > 0 ? ` L ${curveStartX} ${sourceY}` : ''
  return `M ${sourceX} ${sourceY}${stem} C ${control1X} ${sourceY}, ${control2X} ${targetY}, ${targetX} ${targetY}`
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
