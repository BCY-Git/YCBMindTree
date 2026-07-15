import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { MindTreeDatabase } from './database'

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

    expect(current.verno).toBe(8)
    expect(current.tables.map((table) => table.name)).toEqual(expect.arrayContaining(['documents', 'depositBatches', 'depositProvenance', 'depositWorkspaceTransactions', 'workflowSessions', 'depositMetrics']))
    expect(await current.documents.get(document.id)).toEqual(document)
    current.close()
  })
})
