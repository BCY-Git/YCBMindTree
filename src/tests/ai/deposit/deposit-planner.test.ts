import { describe, expect, it } from 'vitest'
import { executeCommand } from '@/domain/commands'
import { createInitialDocument } from '@/domain/document.factory'
import type { DepositBatch } from '@/ai/deposit/deposit-types'
import { buildDepositPlan } from '@/ai/deposit/deposit-planner'

function batch(documentId: string, updatedAt: number, candidate: DepositBatch['candidates'][number]): DepositBatch {
  return { id: 'batch-1', sourceDocumentId: documentId, sourceNodeIds: ['source'], scope: 'subtree', sourceDocumentUpdatedAt: updatedAt, sourceSnapshot: 'source', status: 'pending', summary: '', candidates: [candidate], createdAt: 1, updatedAt: 1, appliedAt: null }
}

describe('deposit planner and atomic command', () => {
  it('creates a task node as one undoable command', () => {
    const document = createInitialDocument()
    const parentId = document.nodes[document.rootId].childIds[0]
    const candidate = { id: 'candidate-1', batchId: 'batch-1', type: 'task' as const, title: '修改地图瓦片路径', detail: '出差前完成', sourceNodeIds: [parentId], suggestedDocumentId: document.id, suggestedParentId: parentId, suggestedTargetNodeId: null, action: 'create' as const, confidence: 0.9, reason: '', duplicateOfCandidateId: null, status: 'accepted' as const, fingerprint: 'fingerprint' }
    const plan = buildDepositPlan([document], batch(document.id, document.updatedAt, candidate))
    const result = executeCommand(document, { type: 'APPLY_DEPOSIT_OPERATIONS', batchId: plan.batchId, operations: plan.operations.map((item) => item.operation) })
    const created = Object.values(result.document.nodes).find((node) => node.topic === candidate.title)

    expect(created).toMatchObject({ parentId, taskStatus: 'todo', note: candidate.detail })
    expect(Object.keys(document.nodes)).not.toContain(created?.id)
  })

  it('does not partially mutate the source when a later operation is invalid', () => {
    const document = createInitialDocument()
    const nodeId = document.nodes[document.rootId].childIds[0]
    expect(() => executeCommand(document, { type: 'APPLY_DEPOSIT_OPERATIONS', batchId: 'batch-1', operations: [
      { type: 'APPEND_NODE_NOTE', nodeId, content: '第一条有效内容' },
      { type: 'COMPLETE_TASK', nodeId: 'missing', evidence: '无效目标' },
    ] })).toThrow('沉淀目标节点不存在')
    expect(document.nodes[nodeId].note).toBe('')
  })

  it('updates notes, appends evidence and completes tasks without deleting source data', () => {
    const document = createInitialDocument()
    const nodeId = document.nodes[document.rootId].childIds[0]
    document.nodes[nodeId].note = '原始记录'
    document.nodes[nodeId].taskStatus = 'todo'
    const result = executeCommand(document, { type: 'APPLY_DEPOSIT_OPERATIONS', batchId: 'batch-actions', operations: [
      { type: 'UPDATE_NODE', nodeId, patch: { note: '阶段结论' } },
      { type: 'APPEND_NODE_NOTE', nodeId, content: '补充依据' },
      { type: 'COMPLETE_TASK', nodeId, evidence: '已经验收' },
    ] }).document

    expect(result.nodes[nodeId]).toMatchObject({ taskStatus: 'done', note: '阶段结论\n\n补充依据\n\n已经验收' })
    expect(document.nodes[nodeId]).toMatchObject({ taskStatus: 'todo', note: '原始记录' })
  })

  it('groups a cross-document candidate under the target document and records both versions', () => {
    const source = createInitialDocument()
    const target = createInitialDocument()
    target.title = 'AFSIM 项目'
    const targetNodeId = target.nodes[target.rootId].childIds[0]
    const candidate = { id: 'candidate-cross', batchId: 'batch-1', type: 'result' as const, title: 'PPT 已交付', detail: '已经发给负责人', sourceNodeIds: [source.rootId], suggestedDocumentId: target.id, suggestedParentId: null, suggestedTargetNodeId: targetNodeId, action: 'append-note' as const, confidence: 0.95, reason: '', duplicateOfCandidateId: null, status: 'accepted' as const, fingerprint: 'cross' }
    const plan = buildDepositPlan([source, target], batch(source.id, source.updatedAt, candidate))

    expect(plan.expectedDocumentUpdatedAt).toEqual({ [source.id]: source.updatedAt, [target.id]: target.updatedAt })
    expect(plan.operations[0]).toMatchObject({ candidateId: candidate.id, documentId: target.id, operation: { type: 'APPEND_NODE_NOTE', nodeId: targetNodeId } })
  })
})
