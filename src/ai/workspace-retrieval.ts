import type { DepositProvenance } from './deposit/deposit-types'
import type { MindMapDocument } from '../domain/document.types'
import type { Tag } from '../domain/tag-library'
import { searchWorkspaceNodes } from '../search/workspace-search'

export type RetrievedWorkspaceNode = {
  documentId: string
  documentTitle: string
  nodeId: string
  topic: string
  path: string
  note: string
  taskStatus: string
  tags: string[]
}

export type WorkspaceRetrievalInput = {
  documents: MindMapDocument[]
  currentDocumentId: string
  text: string
  focusText?: string
  tags?: Tag[]
  provenance?: DepositProvenance[]
  limit?: number
}

const ignoredKeywords = new Set(['应该', '怎么', '如何', '什么', '帮我', '这个', '一下', '目前', '关于', '理解'])

function retrievalKeywords(value: string) {
  const tokens = value.match(/[\p{Script=Han}]{2,}|[A-Za-z0-9][A-Za-z0-9_.+#-]{1,}/gu) ?? []
  return [...new Set(tokens.map((token) => token.trim()).filter((token) => token.length >= 2 && !ignoredKeywords.has(token)))].slice(0, 8)
}

function clipped(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

/** 为 AI 找出少量、可解释的跨图上下文；不返回附件、全图或未命中的原文。 */
export function retrieveWorkspaceContext({ documents, currentDocumentId, text, focusText = '', tags = [], provenance = [], limit = 12 }: WorkspaceRetrievalInput): RetrievedWorkspaceNode[] {
  const workspaceDocuments = documents.filter((document) => document.id !== currentDocumentId && !document.isDraft)
  const tagById = new Map(tags.map((tag) => [tag.id, tag.name]))
  const selected = new Map<string, RetrievedWorkspaceNode>()
  for (const keyword of retrievalKeywords(`${text} ${focusText}`)) {
    for (const result of searchWorkspaceNodes({ documents: workspaceDocuments, tags, provenance, text: keyword, limit })) {
      const key = `${result.documentId}\u0000${result.nodeId}`
      if (selected.has(key)) continue
      const node = documents.find((document) => document.id === result.documentId)?.nodes[result.nodeId]
      if (!node) continue
      selected.set(key, {
        documentId: result.documentId,
        documentTitle: result.documentTitle,
        nodeId: result.nodeId,
        topic: result.topic,
        path: result.path,
        note: clipped(node.note, 600),
        taskStatus: node.taskStatus,
        tags: node.tagIds.flatMap((tagId) => tagById.get(tagId) ?? []),
      })
      if (selected.size >= limit) return [...selected.values()]
    }
  }
  return [...selected.values()]
}
