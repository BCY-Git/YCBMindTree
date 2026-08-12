import type { MindMapDocument } from '@/domain/document.types'
import type { DepositBatch, DepositCandidate, DepositPlan, LocalDepositOperation } from '@/ai/deposit/deposit-types'

function appendWithHeading(existing: string, content: string) {
  const value = content.trim()
  if (!value) return existing
  const heading = `【智能沉淀 · ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format()}】`
  return [existing.trim(), `${heading}\n${value}`].filter(Boolean).join('\n\n')
}

function operationFor(documents: ReadonlyMap<string, MindMapDocument>, candidate: DepositCandidate): { documentId: string; operation: LocalDepositOperation } | null {
  if (candidate.action === 'keep') return null
  const documentId = candidate.suggestedDocumentId
  const document = documentId ? documents.get(documentId) : undefined
  if (!documentId || !document) throw new Error(`「${candidate.title}」缺少有效的目标导图。`)
  if (candidate.action === 'create') {
    const parentId = candidate.suggestedParentId
    if (!parentId || !document.nodes[parentId] || document.nodes[parentId].isFreeTopic) throw new Error(`「${candidate.title}」缺少有效的新增位置。`)
    return { documentId, operation: { type: 'CREATE_BRANCH', parentId, branch: { topic: candidate.title, note: candidate.detail, links: [], attachments: [], taskStatus: candidate.type === 'task' ? 'todo' : 'none', priority: 0, dueDate: null, marks: candidate.type === 'problem' ? ['risk'] : candidate.type === 'idea' ? ['idea'] : [], tagIds: [], collapsed: false, children: [] } } }
  }
  const nodeId = candidate.suggestedTargetNodeId
  if (!nodeId || !document.nodes[nodeId]) throw new Error(`「${candidate.title}」缺少有效的更新目标。`)
  if (candidate.action === 'update') return { documentId, operation: { type: 'UPDATE_NODE', nodeId, patch: { note: candidate.detail } } }
  if (candidate.action === 'complete') return { documentId, operation: { type: 'COMPLETE_TASK', nodeId, evidence: candidate.detail || candidate.title } }
  return { documentId, operation: { type: 'APPEND_NODE_NOTE', nodeId, content: candidate.detail || candidate.title } }
}

export function buildDepositPlan(workspaceDocuments: MindMapDocument[], batch: DepositBatch): DepositPlan {
  const documents = new Map(workspaceDocuments.map((document) => [document.id, document]))
  const sourceDocument = documents.get(batch.sourceDocumentId)
  if (!sourceDocument) throw new Error('找不到本次沉淀的来源导图。')
  if (sourceDocument.updatedAt !== batch.sourceDocumentUpdatedAt) throw new Error('来源导图在生成建议后已经变化，请重新分析。')
  const candidates = batch.candidates.filter((candidate) => candidate.status === 'accepted')
  if (!candidates.length) throw new Error('请先选择至少一条沉淀建议。')
  const operations = candidates.flatMap((candidate) => {
    const planned = operationFor(documents, candidate)
    return planned ? [{ candidateId: candidate.id, ...planned }] : []
  })
  const relevantDocumentIds = new Set([batch.sourceDocumentId, ...operations.map((item) => item.documentId)])
  return {
    batchId: batch.id,
    expectedDocumentUpdatedAt: Object.fromEntries([...relevantDocumentIds].map((documentId) => [documentId, documents.get(documentId)?.updatedAt ?? -1])),
    operations,
    includedCandidateIds: candidates.map((candidate) => candidate.id),
  }
}

export function previewDepositOperation(document: MindMapDocument, operation: LocalDepositOperation) {
  const nodeTopic = (id: string) => document.nodes[id]?.topic ?? '已删除节点'
  if (operation.type === 'CREATE_BRANCH') return `新增：${nodeTopic(operation.parentId)} › ${operation.branch.topic}`
  if (operation.type === 'COMPLETE_TASK') return `完成：${nodeTopic(operation.nodeId)}`
  if (operation.type === 'APPEND_NODE_NOTE') return `追加备注：${nodeTopic(operation.nodeId)}`
  return `更新备注：${nodeTopic(operation.nodeId)}`
}

export function appendDepositNote(existing: string, content: string) {
  return appendWithHeading(existing, content)
}
