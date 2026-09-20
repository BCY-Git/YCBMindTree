import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collectDocumentAttachments, downloadMissingAttachments, uploadMissingAttachments } from '@/sync/attachment-sync'
import { createInitialDocument } from '@/domain/document.factory'
import type { MindMapDocument } from '@/domain/document.types'

const existsMock = vi.fn<() => Promise<boolean>>()
const uploadMock = vi.fn<() => Promise<void>>()
const downloadMock = vi.fn<() => Promise<Blob | null>>()
const getLocalMock = vi.fn<() => Promise<{ blob: Blob } | undefined>>()
const storeLocalMock = vi.fn<() => Promise<void>>()

vi.mock('@/sync/sync-client', () => ({
  remoteAttachmentExists: (...args: unknown[]) => existsMock(...(args as [])),
  uploadAttachment: (...args: unknown[]) => uploadMock(...(args as [])),
  fetchRemoteAttachment: (...args: unknown[]) => downloadMock(...(args as [])),
  loadSyncConfig: () => ({ serverUrl: 'https://sync.example', token: '' }),
}))

vi.mock('@/persistence/database', () => ({
  getNodeAttachment: () => getLocalMock(),
  storeAttachmentBlob: () => storeLocalMock(),
}))

vi.mock('@/store/editor.store', () => ({
  useEditorStore: { getState: () => ({ document: createInitialDocument() }) },
}))

const config = { serverUrl: 'https://sync.example', token: 't', autoSync: true }

function documentWithAttachment(id = 'att-1'): MindMapDocument {
  const document = createInitialDocument()
  const root = document.nodes[document.rootId]
  root.attachments = [{ id, name: 'a.png', type: 'image/png', size: 3, createdAt: 1 }]
  return document
}

beforeEach(() => {
  vi.clearAllMocks()
  existsMock.mockResolvedValue(false)
  getLocalMock.mockResolvedValue({ blob: new Blob(['png']) })
  downloadMock.mockResolvedValue(new Blob(['png']))
})

describe('attachment sync', () => {
  it('collects attachment refs with their node ids', () => {
    const document = documentWithAttachment()
    const refs = collectDocumentAttachments(document)
    expect(refs).toHaveLength(1)
    expect(refs[0].nodeId).toBe(document.rootId)
    expect(refs[0].meta.id).toBe('att-1')
  })

  it('uploads only attachments missing on the remote', async () => {
    const result = await uploadMissingAttachments(config, documentWithAttachment())
    expect(result).toEqual({ transferred: 1, skipped: 0, failed: 0 })
    expect(uploadMock).toHaveBeenCalledOnce()
  })

  it('skips upload when remote already has the bytes', async () => {
    existsMock.mockResolvedValue(true)
    const result = await uploadMissingAttachments(config, documentWithAttachment())
    expect(result).toEqual({ transferred: 0, skipped: 1, failed: 0 })
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('downloads attachments missing locally after a pull', async () => {
    getLocalMock.mockResolvedValue(undefined)
    const result = await downloadMissingAttachments(config, documentWithAttachment())
    expect(result).toEqual({ transferred: 1, skipped: 0, failed: 0 })
    expect(storeLocalMock).toHaveBeenCalledOnce()
  })

  it('keeps going when a single attachment fails', async () => {
    uploadMock.mockRejectedValueOnce(new Error('网络错误'))
    const result = await uploadMissingAttachments(config, documentWithAttachment())
    expect(result.failed).toBe(1)
  })
})
