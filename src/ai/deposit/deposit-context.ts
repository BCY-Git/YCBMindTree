import type { MindMapDocument } from '../../domain/document.types'
import type { DepositAnalysisContext, DepositContextNode } from './deposit-types'

function pathFor(document: MindMapDocument, nodeId: string) {
  const path: string[] = []
  let current: MindMapDocument['nodes'][string] | undefined = document.nodes[nodeId]
  while (current) {
    path.unshift(current.topic)
    current = current.parentId ? document.nodes[current.parentId] : undefined
  }
  return path
}

function subtreeIds(document: MindMapDocument, nodeId: string) {
  const result: string[] = []
  const visit = (id: string) => {
    const node = document.nodes[id]
    if (!node) return
    result.push(id)
    node.childIds.forEach(visit)
  }
  visit(nodeId)
  return result
}

export function buildDepositContext(document: MindMapDocument, sourceNodeId: string, appliedFingerprints: string[]): DepositAnalysisContext {
  const sourceIds = subtreeIds(document, sourceNodeId)
  const toContextNode = (id: string): DepositContextNode => {
    const node = document.nodes[id]
    return { id, path: pathFor(document, id), topic: node.topic, note: node.note, taskStatus: node.taskStatus, priority: node.priority, dueDate: node.dueDate, marks: node.marks, tagIds: node.tagIds }
  }
  return {
    source: { documentId: document.id, title: document.title, rootId: document.rootId, selectedNodeIds: [sourceNodeId], nodes: sourceIds.map(toContextNode) },
    // MVP 限定当前文档；仍提供全图目标节点，优先更新既有项目或知识主题。
    destinations: [{ documentId: document.id, title: document.title, candidateNodes: Object.keys(document.nodes).map((id) => ({ id, path: pathFor(document, id), topic: document.nodes[id].topic })) }],
    alreadyAppliedFingerprints: appliedFingerprints,
  }
}

export function serializeDepositSource(context: DepositAnalysisContext) {
  return context.source.nodes.map((node) => `${node.path.join(' › ')}${node.note ? `：${node.note}` : ''}`).join('\n').slice(0, 12_000)
}
