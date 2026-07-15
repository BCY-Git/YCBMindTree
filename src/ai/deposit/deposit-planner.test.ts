import { describe, expect, it } from 'vitest'
import { executeCommand } from '../../domain/commands'
import { createInitialDocument } from '../../domain/document.factory'
import type { DepositBatch } from './deposit-types'
import { buildDepositPlan } from './deposit-planner'

function batch(documentId: string, updatedAt: number, candidate: DepositBatch['candidates'][number]): DepositBatch {
  return { id: 'batch-1', sourceDocumentId: documentId, sourceNodeIds: ['source'], scope: 'subtree', sourceDocumentUpdatedAt: updatedAt, sourceSnapshot: 'source', status: 'pending', summary: '', candidates: [candidate], createdAt: 1, updatedAt: 1, appliedAt: null }
}

describe('deposit planner and atomic command', () => {
  it('creates a task node as one undoable command', () => {
    const document = createInitialDocument()
    const parentId = document.nodes[document.rootId].childIds[0]
    const candidate = { id: 'candidate-1', batchId: 'batch-1', type: 'task' as const, title: '修改地图瓦片路径', detail: '出差前完成', sourceNodeIds: [parentId], suggestedDocumentId: document.id, suggestedParentId: parentId, suggestedTargetNodeId: null, action: 'create' as const, confidence: 0.9, reason: '', duplicateOfCandidateId: null, status: 'accepted' as const, fingerprint: 'fingerprint' }
    const plan = buildDepositPlan(document, batch(document.id, document.updatedAt, candidate))
    const result = executeCommand(document, { type: 'APPLY_DEPOSIT_OPERATIONS', operations: plan.operations })
    const created = Object.values(result.document.nodes).find((node) => node.topic === candidate.title)

    expect(created).toMatchObject({ parentId, taskStatus: 'todo', note: candidate.detail })
    expect(Object.keys(document.nodes)).not.toContain(created?.id)
  })

  it('does not partially mutate the source when a later operation is invalid', () => {
    const document = createInitialDocument()
    const nodeId = document.nodes[document.rootId].childIds[0]
    expect(() => executeCommand(document, { type: 'APPLY_DEPOSIT_OPERATIONS', operations: [
      { type: 'APPEND_NODE_NOTE', nodeId, content: '第一条有效内容' },
      { type: 'COMPLETE_TASK', nodeId: 'missing', evidence: '无效目标' },
    ] })).toThrow('沉淀目标节点不存在')
    expect(document.nodes[nodeId].note).toBe('')
  })
})
