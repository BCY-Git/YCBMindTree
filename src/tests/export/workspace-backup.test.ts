import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '@/domain/document.factory'
import { createWorkspaceBackup, parseWorkspaceBackup, prepareWorkspaceRestore } from '@/export/workspace-backup'
import type { DepositBatch, DepositProvenance } from '@/ai/deposit/deposit-types'
import { createWorkflowSession } from '@/ai/workflow/workflow-service'

function readText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
}

function depositData(documentId: string, nodeId: string): { depositBatches: DepositBatch[]; depositProvenance: DepositProvenance[] } {
  const candidate = { id: 'candidate-1', batchId: 'batch-1', type: 'task' as const, title: '继续验证', detail: '来自日报', sourceNodeIds: [nodeId], suggestedDocumentId: documentId, suggestedParentId: nodeId, suggestedTargetNodeId: null, action: 'create' as const, confidence: 0.9, reason: '明确的后续动作', duplicateOfCandidateId: null, status: 'applied' as const, fingerprint: 'fingerprint-1' }
  return {
    depositBatches: [{ id: 'batch-1', sourceDocumentId: documentId, sourceNodeIds: [nodeId], scope: 'subtree', sourceDocumentUpdatedAt: 1, sourceSnapshot: '日报 › 继续验证', status: 'applied', summary: '一条任务', candidates: [candidate], createdAt: 1, updatedAt: 2, appliedAt: 2 }],
    depositProvenance: [{ id: 'provenance-1', batchId: 'batch-1', candidateId: candidate.id, sourceDocumentId: documentId, sourceNodeIds: [nodeId], sourceSnapshot: '日报 › 继续验证', targetDocumentId: documentId, targetNodeIds: [nodeId], action: 'create', model: 'test-model', acceptedByUser: true, createdAt: 2 }],
  }
}

describe('workspace backup', () => {
  it('round-trips documents and workspace metadata through a compressed backup', async () => {
    const document = createInitialDocument()
    const archive = await createWorkspaceBackup({
      documents: [document],
      versions: [],
      attachments: [],
      categories: [{ id: 'uncategorized', name: '未分类' }],
      tags: [{ id: 'work', name: '工作', color: '#3f8f78' }],
      depositBatches: [],
      depositProvenance: [],
      workflowSessions: [createWorkflowSession(document.id, document.rootId, '完成 AFSIM PPT')],
    })
    const restored = await parseWorkspaceBackup(archive)

    expect(restored.documents).toEqual([document])
    expect(restored.categories).toEqual([{ id: 'uncategorized', name: '未分类' }])
    expect(restored.tags).toEqual([{ id: 'work', name: '工作', color: '#3f8f78' }])
    expect(restored.workflowSessions[0]).toMatchObject({ documentId: document.id, goal: '完成 AFSIM PPT' })
  })

  it('keeps attachment bytes outside the manifest and restores them with their node', async () => {
    const document = createInitialDocument()
    const attachment = { id: 'attachment-1', name: 'note.txt', type: 'text/plain', size: 5, createdAt: 1 }
    document.nodes[document.rootId].attachments = [attachment]
    const archive = await createWorkspaceBackup({
      documents: [document], versions: [], categories: [], tags: [], depositBatches: [], depositProvenance: [], workflowSessions: [],
      attachments: [{ ...attachment, documentId: document.id, nodeId: document.rootId, blob: new Blob(['hello'], { type: 'text/plain' }) }],
    })
    const restored = await parseWorkspaceBackup(archive)

    expect(restored.attachments).toHaveLength(1)
    expect(restored.attachments[0]).toMatchObject({ ...attachment, documentId: document.id, nodeId: document.rootId })
    expect(await readText(restored.attachments[0].blob)).toBe('hello')
  })

  it('restores colliding documents as linked-safe copies, including versions and attachments', () => {
    const document = createInitialDocument()
    document.categoryId = 'project'
    document.nodes[document.rootId].tagIds = ['work']
    const attachment = { id: 'attachment-1', name: 'note.txt', type: 'text/plain', size: 5, createdAt: 1 }
    document.nodes[document.rootId].attachments = [attachment]
    const backup = {
      documents: [document],
      versions: [{ id: 'version-1', documentId: document.id, kind: 'manual' as const, label: '保存', snapshot: structuredClone(document), createdAt: 2 }],
      attachments: [{ ...attachment, documentId: document.id, nodeId: document.rootId, blob: new Blob(['hello']) }],
      categories: [{ id: 'project', name: '项目' }],
      tags: [{ id: 'work', name: '工作', color: '#3f8f78' }],
      ...depositData(document.id, document.rootId),
      workflowSessions: [createWorkflowSession(document.id, document.rootId, '完成 AFSIM PPT')],
    }
    const restored = prepareWorkspaceRestore(backup, {
      documents: [document], attachmentIds: new Set(['attachment-1']), categories: [], tags: [],
    }, 1_700_000_000_000)

    const copy = restored.documents[0]
    expect(copy.id).not.toBe(document.id)
    expect(copy.title).toBe(`${document.title}（恢复副本）`)
    expect(copy.nodes[copy.rootId].attachments[0].id).not.toBe(attachment.id)
    expect(restored.attachments[0].documentId).toBe(copy.id)
    expect(restored.attachments[0].id).toBe(copy.nodes[copy.rootId].attachments[0].id)
    expect(restored.versions[0].documentId).toBe(copy.id)
    expect(restored.versions[0].snapshot.id).toBe(copy.id)
    expect(restored.depositBatches[0].id).not.toBe('batch-1')
    expect(restored.depositBatches[0].sourceDocumentId).toBe(copy.id)
    expect(restored.depositProvenance[0]).toMatchObject({ sourceDocumentId: copy.id, targetDocumentId: copy.id, batchId: restored.depositBatches[0].id })
    expect(restored.workflowSessions[0]).toMatchObject({ documentId: copy.id, focusNodeId: document.rootId, goal: '完成 AFSIM PPT' })
  })

  it('round-trips applied deposit batches and provenance', async () => {
    const document = createInitialDocument()
    const deposit = depositData(document.id, document.rootId)
    const archive = await createWorkspaceBackup({ documents: [document], versions: [], attachments: [], categories: [], tags: [], ...deposit, workflowSessions: [] })
    const restored = await parseWorkspaceBackup(archive)

    expect(restored.depositBatches).toEqual(deposit.depositBatches)
    expect(restored.depositProvenance).toEqual(deposit.depositProvenance)
  })
})
