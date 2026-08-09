import { describe, expect, it, vi } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import type { MindMapDocument } from '../domain/document.types'
import { isUntouchedStarterDocument, synchronizeAccountLibrary, type AccountLibrarySyncDependencies } from './account-library'
import type { RemoteDocument, SyncConfig } from './sync-client'

const config: SyncConfig = { serverUrl: 'https://sync.example.com', token: 'session-token' }

function remote(document: MindMapDocument, version = 1): RemoteDocument {
  return { id: document.id, version, payload: document, updatedAt: document.updatedAt }
}

function dependencies(local: MindMapDocument[], cloud: RemoteDocument[]) {
  const documents = [...local]
  const metadata = new Map<string, { documentId: string; remoteVersion: number; syncedAt: number }>()
  const deps: AccountLibrarySyncDependencies = {
    listLocalDocuments: vi.fn(async () => [...documents]),
    listRemoteDocuments: vi.fn(async () => cloud),
    loadMetadata: vi.fn(async (documentId) => metadata.get(documentId)),
    saveLocalDocument: vi.fn(async (document) => {
      const index = documents.findIndex((item) => item.id === document.id)
      if (index === -1) documents.push(document)
      else documents[index] = document
    }),
    saveMetadata: vi.fn(async (value) => { metadata.set(value.documentId, value) }),
    pushLocalDocument: vi.fn(async (_config, document) => ({ type: 'saved' as const, remote: remote(document) })),
  }
  return { deps, documents, metadata }
}

describe('account library synchronization', () => {
  it('imports cloud documents on a fresh web workspace without uploading its tutorial map', async () => {
    const starter = createInitialDocument()
    const cloudDocument = { ...createInitialDocument(), id: 'cloud-document', title: '客户端导图' }
    const { deps } = dependencies([starter], [remote(cloudDocument, 3)])

    const result = await synchronizeAccountLibrary(config, deps)

    expect(result.imported).toBe(1)
    expect(result.uploaded).toBe(0)
    expect(result.preferredDocument?.id).toBe('cloud-document')
    expect(deps.pushLocalDocument).not.toHaveBeenCalled()
    expect(result.documents.some((document) => document.id === 'cloud-document')).toBe(true)
  })

  it('uploads existing client documents when the account cloud library is empty', async () => {
    const local = { ...createInitialDocument(), id: 'local-document', title: '项目规划', updatedAt: Date.now() + 1 }
    const { deps } = dependencies([local], [])

    const result = await synchronizeAccountLibrary(config, deps)

    expect(result.uploaded).toBe(1)
    expect(deps.pushLocalDocument).toHaveBeenCalledWith(config, local, 0)
  })

  it('keeps a locally edited document when the cloud also has a newer version', async () => {
    const base = { ...createInitialDocument(), id: 'shared-document', title: '本地版本' }
    const local = { ...base, updatedAt: 20_000 }
    const cloud = { ...base, title: '云端版本', updatedAt: 18_000 }
    const { deps, metadata } = dependencies([local], [remote(cloud, 2)])
    metadata.set(local.id, { documentId: local.id, remoteVersion: 1, syncedAt: 10_000 })

    const result = await synchronizeAccountLibrary(config, deps)

    expect(result.conflicts).toBe(1)
    expect(result.documents.find((document) => document.id === local.id)?.title).toBe('本地版本')
  })

  it('recognizes only the untouched built-in tutorial as a disposable starter', () => {
    const starter = createInitialDocument()
    expect(isUntouchedStarterDocument(starter)).toBe(true)
    expect(isUntouchedStarterDocument({ ...starter, title: '我的项目', updatedAt: starter.updatedAt + 1 })).toBe(false)
  })
})
