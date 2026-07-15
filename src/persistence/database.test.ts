import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { getDepositMetricSummary, markDepositTargetRevisited, MindTreeDatabase } from './database'

const names: string[] = []

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)))
})

describe('MindTree IndexedDB migrations', () => {
  it('upgrades a version-4 workspace without losing documents and creates deposit/workflow tables', async () => {
    const name = `mindtree-migration-${crypto.randomUUID()}`
    names.push(name)
    const legacy = new Dexie(name)
    legacy.version(4).stores({
      documents: 'id, title, updatedAt', syncMetadata: 'documentId, syncedAt',
      documentVersions: 'id, documentId, createdAt, [documentId+createdAt], kind', attachments: 'id, documentId, nodeId, createdAt',
    })
    const document = createInitialDocument()
    await legacy.table('documents').put(document)
    legacy.close()

    const current = new MindTreeDatabase(name)
    await current.open()

    expect(current.verno).toBe(9)
    expect(current.tables.map((table) => table.name)).toEqual(expect.arrayContaining(['documents', 'depositBatches', 'depositProvenance', 'depositWorkspaceTransactions', 'workflowSessions', 'depositMetrics']))
    expect(await current.documents.get(document.id)).toEqual(document)
    current.close()
  })

  it('counts a deposited result as revisited only once when its target is selected again', async () => {
    const name = `mindtree-metrics-${crypto.randomUUID()}`
    names.push(name)
    const current = new MindTreeDatabase(name)
    await current.open()
    await current.depositProvenance.put({
      id: 'provenance-1', batchId: 'batch-1', candidateId: 'candidate-1',
      sourceDocumentId: 'source-document', sourceNodeIds: ['source-node'], sourceSnapshot: '{}',
      targetDocumentId: 'target-document', targetNodeIds: ['target-node'], action: 'create',
      model: 'test-model', acceptedByUser: true, createdAt: 1_000,
    })

    await markDepositTargetRevisited('target-document', 'target-node', current)
    await markDepositTargetRevisited('target-document', 'target-node', current)

    expect((await getDepositMetricSummary('target-document', current)).revisited).toBe(1)
    current.close()
  })
})
