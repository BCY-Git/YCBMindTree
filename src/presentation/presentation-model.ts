import type { MindMapDocument } from '@/domain/document.types'

export type PresentationStep = {
  nodeId: string
  topic: string
  note: string
  path: string[]
  childTopics: string[]
}

export function buildPresentationSteps(document: MindMapDocument, startNodeId = document.rootId): PresentationStep[] {
  if (!document.nodes[startNodeId]) return []
  const steps: PresentationStep[] = []
  const ancestorTopics: string[] = []
  let ancestor = document.nodes[startNodeId]
  while (ancestor.parentId) {
    ancestor = document.nodes[ancestor.parentId]
    if (!ancestor) break
    ancestorTopics.unshift(ancestor.topic)
  }
  const visit = (nodeId: string, path: string[]) => {
    const node = document.nodes[nodeId]
    const nextPath = [...path, node.topic]
    steps.push({ nodeId, topic: node.topic, note: node.note, path: nextPath, childTopics: node.childIds.map((id) => document.nodes[id]?.topic).filter(Boolean) })
    if (!node.collapsed) node.childIds.forEach((childId) => visit(childId, nextPath))
  }
  visit(startNodeId, ancestorTopics)
  return steps
}
