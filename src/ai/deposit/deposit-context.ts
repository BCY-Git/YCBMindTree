import type { MindMapDocument } from '../../domain/document.types'
import type { DepositAnalysisContext, DepositContextNode } from './deposit-types'

export const depositContextLimits = { sourceNodes: 160, destinationNodes: 240, topicCharacters: 500, noteCharacters: 2_000 } as const

function clipped(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

function pathFor(document: MindMapDocument, nodeId: string) {
  const path: string[] = []
  let current: MindMapDocument['nodes'][string] | undefined = document.nodes[nodeId]
  while (current) {
    path.unshift(clipped(current.topic, 200))
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
  const includedSourceIds = sourceIds.slice(0, depositContextLimits.sourceNodes)
  const toContextNode = (id: string): DepositContextNode => {
    const node = document.nodes[id]
    return { id, path: pathFor(document, id), topic: clipped(node.topic, depositContextLimits.topicCharacters), note: clipped(node.note, depositContextLimits.noteCharacters), taskStatus: node.taskStatus, priority: node.priority, dueDate: node.dueDate, marks: node.marks, tagIds: node.tagIds }
  }
  const destinationNodes = Object.values(document.nodes)
    .sort((left, right) => (left.id === document.rootId ? -1 : right.id === document.rootId ? 1 : right.updatedAt - left.updatedAt))
  const includedDestinations = destinationNodes.slice(0, depositContextLimits.destinationNodes)
  return {
    source: { documentId: document.id, title: document.title, rootId: document.rootId, selectedNodeIds: [sourceNodeId], nodes: includedSourceIds.map(toContextNode), totalNodeCount: sourceIds.length, truncated: includedSourceIds.length < sourceIds.length },
    // MVP 限定当前文档；仍提供全图目标节点，优先更新既有项目或知识主题。
    destinations: [{ documentId: document.id, title: document.title, candidateNodes: includedDestinations.map((node) => ({ id: node.id, path: pathFor(document, node.id), topic: clipped(node.topic, depositContextLimits.topicCharacters) })), totalNodeCount: destinationNodes.length, truncated: includedDestinations.length < destinationNodes.length }],
    alreadyAppliedFingerprints: appliedFingerprints,
  }
}

export function serializeDepositSource(context: DepositAnalysisContext) {
  return context.source.nodes.map((node) => `${node.path.join(' › ')}${node.note ? `：${node.note}` : ''}`).join('\n').slice(0, 12_000)
}
