import type { MindMapDocument } from '../../domain/document.types'
import type { DepositBatch, DepositCandidate, DepositPlan, LocalDepositOperation } from './deposit-types'

function appendWithHeading(existing: string, content: string) {
  const value = content.trim()
  if (!value) return existing
  const heading = `【智能沉淀 · ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format()}】`
  return [existing.trim(), `${heading}\n${value}`].filter(Boolean).join('\n\n')
}

function operationFor(document: MindMapDocument, candidate: DepositCandidate): LocalDepositOperation | null {
  if (candidate.action === 'keep') return null
  if (candidate.action === 'create') {
    const parentId = candidate.suggestedParentId
    if (!parentId || !document.nodes[parentId] || document.nodes[parentId].isFreeTopic) throw new Error(`「${candidate.title}」缺少有效的新增位置。`)
    return { type: 'CREATE_BRANCH', parentId, branch: { topic: candidate.title, note: candidate.detail, links: [], attachments: [], taskStatus: candidate.type === 'task' ? 'todo' : 'none', priority: 0, dueDate: null, marks: candidate.type === 'problem' ? ['risk'] : candidate.type === 'idea' ? ['idea'] : [], tagIds: [], collapsed: false, children: [] } }
  }
  const nodeId = candidate.suggestedTargetNodeId
  if (!nodeId || !document.nodes[nodeId]) throw new Error(`「${candidate.title}」缺少有效的更新目标。`)
  if (candidate.action === 'update') return { type: 'UPDATE_NODE', nodeId, patch: { note: candidate.detail } }
  if (candidate.action === 'complete') return { type: 'COMPLETE_TASK', nodeId, evidence: candidate.detail || candidate.title }
  return { type: 'APPEND_NODE_NOTE', nodeId, content: candidate.detail || candidate.title }
}

export function buildDepositPlan(document: MindMapDocument, batch: DepositBatch): DepositPlan {
  if (document.id !== batch.sourceDocumentId) throw new Error('当前导图不是本次沉淀的来源。')
  if (document.updatedAt !== batch.sourceDocumentUpdatedAt) throw new Error('导图在生成建议后已经变化，请重新分析。')
  const candidates = batch.candidates.filter((candidate) => candidate.status === 'accepted')
  if (!candidates.length) throw new Error('请先选择至少一条沉淀建议。')
  return {
    batchId: batch.id,
    expectedDocumentUpdatedAt: batch.sourceDocumentUpdatedAt,
    operations: candidates.map((candidate) => operationFor(document, candidate)).filter((item): item is LocalDepositOperation => item !== null),
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
