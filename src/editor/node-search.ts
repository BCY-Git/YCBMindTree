import type { MindMapDocument } from '@/domain/document.types'

export type NodeSearchResult = {
  nodeId: string
  topic: string
  path: string
  matchedIn: Array<'topic' | 'note' | 'link'>
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase()
}

function nodePath(document: MindMapDocument, nodeId: string) {
  const parts: string[] = []
  let current: MindMapDocument['nodes'][string] | undefined = document.nodes[nodeId]
  while (current) {
    parts.unshift(current.topic)
    current = current.parentId ? document.nodes[current.parentId] : undefined
  }
  return parts.join(' / ')
}

/** 搜索主题、备注及链接，但只返回一条干净的节点结果。 */
export function searchNodes(document: MindMapDocument, query: string, limit = 30): NodeSearchResult[] {
  const needle = normalized(query)
  if (!needle) return []
  return Object.values(document.nodes)
    .map((node) => {
      const matchedIn: NodeSearchResult['matchedIn'] = []
      if (normalized(node.topic).includes(needle)) matchedIn.push('topic')
      if (normalized(node.note).includes(needle)) matchedIn.push('note')
      if (node.links.some((link) => normalized(`${link.label} ${link.url}`).includes(needle))) matchedIn.push('link')
      return matchedIn.length ? { nodeId: node.id, topic: node.topic, path: nodePath(document, node.id), matchedIn } : null
    })
    .filter((item): item is NodeSearchResult => item !== null)
    .sort((left, right) => {
      const leftTopic = normalized(left.topic) === needle ? 0 : left.matchedIn.includes('topic') ? 1 : 2
      const rightTopic = normalized(right.topic) === needle ? 0 : right.matchedIn.includes('topic') ? 1 : 2
      return leftTopic - rightTopic || left.path.localeCompare(right.path, 'zh-CN')
    })
    .slice(0, limit)
}
