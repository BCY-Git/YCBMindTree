import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '@/domain/document.factory'
import type { DepositBatch, DepositProvenance } from '@/ai/deposit/deposit-types'
import { createWorkflowSession } from '@/ai/workflow/workflow-service'
import { buildProjectStatus } from '@/projects/project-status'

function depositedCandidate(batchId: string, id: string, type: 'result' | 'problem' | 'decision', title: string, targetId: string): DepositBatch['candidates'][number] {
  return {
    id, batchId, type, title, detail: `${title} 的说明`, sourceNodeIds: ['daily-entry'],
    suggestedDocumentId: 'project-document', suggestedParentId: null, suggestedTargetNodeId: targetId,
    action: 'append-note', confidence: 0.9, reason: '固定样本', duplicateOfCandidateId: null,
    status: 'applied', fingerprint: `${batchId}:${id}`,
  }
}

function provenance(candidateId: string, targetNodeId: string, createdAt: number): DepositProvenance {
  return {
    id: `provenance-${candidateId}`, batchId: 'batch-1', candidateId,
    sourceDocumentId: 'daily-document', sourceNodeIds: ['daily-entry'], sourceSnapshot: '7.14 日报',
    targetDocumentId: 'project-document', targetNodeIds: [targetNodeId], action: 'append-note',
    model: 'test', acceptedByUser: true, createdAt,
  }
}

describe('project status projection', () => {
  it('turns confirmed deposits and task state into an inspectable project pulse', () => {
    const document = createInitialDocument()
    document.id = 'project-document'
    document.nodes[document.rootId].topic = '无人项目'
    const projectId = document.nodes[document.rootId].childIds[0]
    const taskId = document.nodes[projectId].childIds[0]
    const doneId = document.nodes[projectId].childIds[1]
    document.nodes[taskId] = { ...document.nodes[taskId], topic: '修复得分 bug', taskStatus: 'doing', priority: 1, updatedAt: 120 }
    document.nodes[doneId] = { ...document.nodes[doneId], topic: '完成地图路径检查', taskStatus: 'done', updatedAt: 100 }
    document.nodes[projectId] = { ...document.nodes[projectId], marks: ['risk'] }

    const batch: DepositBatch = {
      id: 'batch-1', sourceDocumentId: 'daily-document', sourceNodeIds: ['daily-entry'], scope: 'subtree',
      sourceDocumentUpdatedAt: 1, sourceSnapshot: '7.14 日报', status: 'applied', summary: '项目进展',
      candidates: [
        depositedCandidate('batch-1', 'result-1', 'result', 'AFSIM PPT 已交付', doneId),
        depositedCandidate('batch-1', 'problem-1', 'problem', '专家反馈尚未落实', projectId),
        depositedCandidate('batch-1', 'decision-1', 'decision', '第一阶段采用 Three.js', projectId),
      ], createdAt: 1, updatedAt: 1, appliedAt: 1,
    }
    const session = createWorkflowSession(document.id, projectId, '完成无人项目评审', 'deliver')
    session.nextActions = ['确认专家反馈的处理方案']
    session.updatedAt = 220

    const status = buildProjectStatus({ document, rootNodeId: projectId, batches: [batch], provenance: [
      provenance('result-1', doneId, 200), provenance('problem-1', projectId, 210), provenance('decision-1', projectId, 215),
    ], workflowSessions: [session] })

    expect(status.goal).toBe('从这里开始')
    expect(status.progress).toEqual({ done: 1, total: 2 })
    expect(status.active.map((item) => item.title)).toEqual(['修复得分 bug'])
    expect(status.blockers.map((item) => item.title)).toEqual(expect.arrayContaining(['从这里开始', '专家反馈尚未落实']))
    expect(status.recentResults.map((item) => item.title)).toEqual(expect.arrayContaining(['完成地图路径检查', 'AFSIM PPT 已交付']))
    expect(status.decisions.map((item) => item.title)).toEqual(['第一阶段采用 Three.js'])
    expect(status.nextActions.map((item) => item.title)).toEqual(expect.arrayContaining(['修复得分 bug', '确认专家反馈的处理方案']))
    expect(status.decisions[0].source).toMatchObject({ documentId: 'daily-document', nodeIds: ['daily-entry'] })
  })

  it('keeps the projection inside the selected branch and ignores pending suggestions', () => {
    const document = createInitialDocument()
    const insideId = document.nodes[document.rootId].childIds[0]
    const outside = document.nodes[document.rootId]
    const outsideId = crypto.randomUUID()
    document.nodes[outsideId] = { ...document.nodes[insideId], id: outsideId, parentId: document.rootId, topic: '其他项目', childIds: [], taskStatus: 'todo' }
    document.nodes[document.rootId] = { ...outside, childIds: [...outside.childIds, outsideId] }
    const batch: DepositBatch = { id: 'batch-2', sourceDocumentId: document.id, sourceNodeIds: [outsideId], scope: 'node', sourceDocumentUpdatedAt: 1, sourceSnapshot: '', status: 'pending', summary: '', candidates: [
      { ...depositedCandidate('batch-2', 'pending-decision', 'decision', '不应出现', outsideId), status: 'accepted' },
    ], createdAt: 1, updatedAt: 1, appliedAt: null }

    const status = buildProjectStatus({ document, rootNodeId: insideId, batches: [batch], provenance: [] })

    expect(status.active).toHaveLength(0)
    expect(status.decisions).toHaveLength(0)
  })
})
