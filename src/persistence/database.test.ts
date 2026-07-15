import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { getDepositMetricSummary, markDepositTargetRevisited, MindTreeDatabase, pruneStoredAttachmentsForDocument } from './database'

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

  it('removes unreferenced blobs while preserving current and version-history images', async () => {
    const name = `mindtree-attachments-${crypto.randomUUID()}`
    names.push(name)
    const current = new MindTreeDatabase(name)
    await current.open()
    const document = createInitialDocument()
    const node = document.nodes[document.rootId]
    const live = { id: 'live-image', name: 'live.png', type: 'image/png', size: 3, createdAt: 1 }
    const historical = { id: 'historical-image', name: 'history.png', type: 'image/png', size: 3, createdAt: 1 }
    node.attachments = [live]
    await current.attachments.bulkPut([
      { ...live, documentId: document.id, nodeId: node.id, blob: new Blob(['img'], { type: 'image/png' }) },
      { ...historical, documentId: document.id, nodeId: node.id, blob: new Blob(['history'], { type: 'image/png' }) },
      { id: 'orphan-image', documentId: document.id, nodeId: 'deleted-node', name: 'old.png', type: 'image/png', size: 3, createdAt: 1, blob: new Blob(['old'], { type: 'image/png' }) },
    ])
    const snapshot = structuredClone(document)
    snapshot.nodes[snapshot.rootId].attachments = [historical]
    await current.documentVersions.put({ id: 'version-with-image', documentId: document.id, kind: 'manual', label: null, snapshot, createdAt: 1 })

    expect(await pruneStoredAttachmentsForDocument(document, current)).toBe(1)
    expect((await current.attachments.toArray()).map((attachment) => attachment.id).sort()).toEqual(['historical-image', 'live-image'])
    await current.documentVersions.clear()
    expect(await pruneStoredAttachmentsForDocument(document, current)).toBe(1)
    expect((await current.attachments.toArray()).map((attachment) => attachment.id)).toEqual(['live-image'])
    current.close()
  })
})
