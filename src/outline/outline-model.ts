import type { MindMapDocument, MindNode } from '@/domain/document.types'
import type { MindMapCommand } from '@/domain/commands'

export type OutlineRow = {
  nodeId: string
  node: MindNode
  depth: number
  hasChildren: boolean
  hiddenChildCount: number
}

/** 将导图层级投影为线性行；顺序完全由 childIds 决定。 */
export function buildOutlineRows(document: MindMapDocument): OutlineRow[] {
  const rows: OutlineRow[] = []
  const visit = (nodeId: string, depth: number) => {
    const node = document.nodes[nodeId]
    if (!node) return
    rows.push({ nodeId, node, depth, hasChildren: node.childIds.length > 0, hiddenChildCount: node.collapsed ? node.childIds.length : 0 })
    if (!node.collapsed) node.childIds.forEach((childId) => visit(childId, depth + 1))
  }
  visit(document.rootId, 0)
  Object.values(document.nodes)
    .filter((node) => node.isFreeTopic && node.id !== document.rootId)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .forEach((node) => visit(node.id, 0))
  return rows
}

export function outlineSiblingMove(document: MindMapDocument, nodeId: string, direction: 'up' | 'down'): MindMapCommand | null {
  const node = document.nodes[nodeId]
  if (!node?.parentId || node.isFreeTopic) return null
  const siblings = document.nodes[node.parentId]?.childIds ?? []
  const index = siblings.indexOf(nodeId)
  if (index < 0 || (direction === 'up' && index === 0) || (direction === 'down' && index === siblings.length - 1)) return null
  return { type: 'MOVE_NODE', nodeId, newParentId: node.parentId, index: direction === 'up' ? index - 1 : index + 2 }
}
