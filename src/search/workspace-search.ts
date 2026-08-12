import type { MindMapDocument, MindNodePriority, MindNodeTaskStatus, NodeMark } from '@/domain/document.types'
import type { Tag } from '@/domain/tag-library'
import type { DepositProvenance } from '@/ai/deposit/deposit-types'

export type WorkspaceSearchMatch = 'topic' | 'note' | 'link' | 'tag'
export type WorkspaceSearchProvenanceRole = 'source' | 'target'

export type WorkspaceSearchResult = {
  documentId: string
  documentTitle: string
  nodeId: string
  topic: string
  path: string
  matchedIn: WorkspaceSearchMatch[]
  provenanceRoles: WorkspaceSearchProvenanceRole[]
  taskStatus: MindNodeTaskStatus
  priority: MindNodePriority
  dueDate: string | null
  marks: NodeMark[]
  tagIds: string[]
}

export type WorkspaceSearchInput = {
  documents: MindMapDocument[]
  tags?: Tag[]
  provenance?: DepositProvenance[]
  text: string
  includeDrafts?: boolean
  filters?: {
    documentIds?: string[]
    tagIds?: string[]
    marks?: NodeMark[]
    statuses?: MindNodeTaskStatus[]
    priorities?: MindNodePriority[]
    provenanceRoles?: WorkspaceSearchProvenanceRole[]
  }
  limit?: number
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

/** 在整个工作区搜索节点；排序优先保证精确主题和主题命中稳定靠前。 */
function matchesAny<T>(selected: T[] | undefined, values: T[]) {
  return !selected?.length || selected.some((value) => values.includes(value))
}

export function searchWorkspaceNodes({ documents, tags = [], provenance = [], text, includeDrafts = false, filters, limit = 50 }: WorkspaceSearchInput): WorkspaceSearchResult[] {
  const needle = normalized(text)
  const hasFilters = Boolean(filters && Object.values(filters).some((values) => values?.length))
  if (!needle && !hasFilters) return []
  const tagNames = new Map(tags.map((tag) => [tag.id, normalized(tag.name)]))
  const rolesByNode = new Map<string, Set<WorkspaceSearchProvenanceRole>>()
  const addRole = (documentId: string, nodeId: string, role: WorkspaceSearchProvenanceRole) => {
    const key = `${documentId}\u0000${nodeId}`
    const roles = rolesByNode.get(key) ?? new Set<WorkspaceSearchProvenanceRole>()
    roles.add(role)
    rolesByNode.set(key, roles)
  }
  provenance.filter((item) => item.acceptedByUser).forEach((item) => {
    item.sourceNodeIds.forEach((nodeId) => addRole(item.sourceDocumentId, nodeId, 'source'))
    if (item.targetDocumentId) item.targetNodeIds.forEach((nodeId) => addRole(item.targetDocumentId!, nodeId, 'target'))
  })
  return documents
    .filter((document) => includeDrafts || !document.isDraft)
    .flatMap((document) => Object.values(document.nodes).flatMap((node) => {
      if (filters?.documentIds?.length && !filters.documentIds.includes(document.id)) return []
      if (!matchesAny(filters?.tagIds, node.tagIds)) return []
      if (!matchesAny(filters?.marks, node.marks)) return []
      if (!matchesAny(filters?.statuses, [node.taskStatus])) return []
      if (!matchesAny(filters?.priorities, [node.priority])) return []
      const provenanceRoles = [...(rolesByNode.get(`${document.id}\u0000${node.id}`) ?? [])]
      if (!matchesAny(filters?.provenanceRoles, provenanceRoles)) return []
      const matchedIn: WorkspaceSearchMatch[] = []
      if (needle && normalized(node.topic).includes(needle)) matchedIn.push('topic')
      if (needle && normalized(node.note).includes(needle)) matchedIn.push('note')
      if (needle && node.links.some((link) => normalized(`${link.label} ${link.url}`).includes(needle))) matchedIn.push('link')
      if (needle && node.tagIds.some((tagId) => tagNames.get(tagId)?.includes(needle))) matchedIn.push('tag')
      return !needle || matchedIn.length ? [{
        documentId: document.id,
        documentTitle: document.title,
        nodeId: node.id,
        topic: node.topic,
        path: nodePath(document, node.id),
        matchedIn,
        provenanceRoles,
        taskStatus: node.taskStatus,
        priority: node.priority,
        dueDate: node.dueDate,
        marks: node.marks,
        tagIds: node.tagIds,
      }] : []
    }))
    .sort((left, right) => {
      const leftRank = normalized(left.topic) === needle ? 0 : left.matchedIn.includes('topic') ? 1 : 2
      const rightRank = normalized(right.topic) === needle ? 0 : right.matchedIn.includes('topic') ? 1 : 2
      return leftRank - rightRank || left.path.localeCompare(right.path, 'zh-CN')
    })
    .slice(0, limit)
}
