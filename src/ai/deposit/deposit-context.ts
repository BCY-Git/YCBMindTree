import type { MindMapDocument } from '../../domain/document.types'
import type { DepositAnalysisContext, DepositContextNode } from './deposit-types'

export const depositContextLimits = { sourceNodes: 160, destinationDocuments: 8, destinationNodes: 240, destinationNodesPerDocument: 60, topicCharacters: 500, noteCharacters: 2_000 } as const

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

export function buildDepositContext(document: MindMapDocument, sourceNodeId: string, appliedFingerprints: string[], workspaceDocuments: MindMapDocument[] = [document]): DepositAnalysisContext {
  const sourceIds = subtreeIds(document, sourceNodeId)
  const includedSourceIds = sourceIds.slice(0, depositContextLimits.sourceNodes)
  const toContextNode = (id: string): DepositContextNode => {
    const node = document.nodes[id]
    return { id, path: pathFor(document, id), topic: clipped(node.topic, depositContextLimits.topicCharacters), note: clipped(node.note, depositContextLimits.noteCharacters), taskStatus: node.taskStatus, priority: node.priority, dueDate: node.dueDate, marks: node.marks, tagIds: node.tagIds }
  }
  const destinationDocuments = [document, ...workspaceDocuments.filter((item) => item.id !== document.id && !item.isDraft).sort((left, right) => right.updatedAt - left.updatedAt)]
    .slice(0, depositContextLimits.destinationDocuments)
  let remainingDestinationNodes = depositContextLimits.destinationNodes
  const destinations = destinationDocuments.map((destination) => {
    const nodes = Object.values(destination.nodes)
      .sort((left, right) => (left.id === destination.rootId ? -1 : right.id === destination.rootId ? 1 : right.updatedAt - left.updatedAt))
    const limit = Math.min(depositContextLimits.destinationNodesPerDocument, remainingDestinationNodes)
    const included = nodes.slice(0, limit)
    remainingDestinationNodes -= included.length
    return { documentId: destination.id, title: destination.title, candidateNodes: included.map((node) => ({ id: node.id, path: pathFor(destination, node.id), topic: clipped(node.topic, depositContextLimits.topicCharacters) })), totalNodeCount: nodes.length, truncated: included.length < nodes.length }
  }).filter((destination) => destination.candidateNodes.length)
  return {
    source: { documentId: document.id, title: document.title, rootId: document.rootId, selectedNodeIds: [sourceNodeId], nodes: includedSourceIds.map(toContextNode), totalNodeCount: sourceIds.length, truncated: includedSourceIds.length < sourceIds.length },
    destinations,
    alreadyAppliedFingerprints: appliedFingerprints,
  }
}

export function serializeDepositSource(context: DepositAnalysisContext) {
  return context.source.nodes.map((node) => `${node.path.join(' › ')}${node.note ? `：${node.note}` : ''}`).join('\n').slice(0, 12_000)
}
