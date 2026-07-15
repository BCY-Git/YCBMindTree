import type { MindMapDocument } from '../domain/document.types'

export type FocusBreadcrumbItem = { nodeId: string; topic: string }

function subtreeIds(document: MindMapDocument, rootId: string) {
  const ids = new Set<string>()
  const visit = (nodeId: string) => {
    const node = document.nodes[nodeId]
    if (!node || ids.has(nodeId)) return
    ids.add(nodeId)
    node.childIds.forEach(visit)
  }
  visit(rootId)
  return ids
}

/** 构造仅供视图和布局使用的子树投影；原始文档与节点 ID 保持不变。 */
export function projectFocusedDocument(document: MindMapDocument, focusNodeId: string): MindMapDocument {
  if (!document.nodes[focusNodeId] || focusNodeId === document.rootId) return document
  const visibleIds = subtreeIds(document, focusNodeId)
  const nodes = Object.fromEntries([...visibleIds].map((nodeId) => {
    const node = structuredClone(document.nodes[nodeId])
    if (nodeId === focusNodeId) node.parentId = null
    return [nodeId, node]
  }))
  return {
    ...document,
    rootId: focusNodeId,
    nodes,
    relations: document.relations.filter((relation) => visibleIds.has(relation.sourceId) && visibleIds.has(relation.targetId)),
    boundaries: document.boundaries.flatMap((boundary) => {
      const nodeIds = boundary.nodeIds.filter((nodeId) => visibleIds.has(nodeId))
      return nodeIds.length >= 2 ? [{ ...boundary, nodeIds }] : []
    }),
    summaries: document.summaries.flatMap((summary) => {
      const nodeIds = summary.nodeIds.filter((nodeId) => visibleIds.has(nodeId))
      return nodeIds.length >= 2 ? [{ ...summary, nodeIds }] : []
    }),
  }
}

export function buildFocusBreadcrumb(document: MindMapDocument, focusNodeId: string): FocusBreadcrumbItem[] {
  const path: FocusBreadcrumbItem[] = []
  let current: MindMapDocument['nodes'][string] | undefined = document.nodes[focusNodeId]
  while (current) {
    path.unshift({ nodeId: current.id, topic: current.topic })
    current = current.parentId ? document.nodes[current.parentId] : undefined
  }
  return path
}
