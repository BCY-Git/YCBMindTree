import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { createWorkspaceBackup, parseWorkspaceBackup, prepareWorkspaceRestore } from './workspace-backup'

function readText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
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
    })
    const restored = await parseWorkspaceBackup(archive)

    expect(restored.documents).toEqual([document])
    expect(restored.categories).toEqual([{ id: 'uncategorized', name: '未分类' }])
    expect(restored.tags).toEqual([{ id: 'work', name: '工作', color: '#3f8f78' }])
  })

  it('keeps attachment bytes outside the manifest and restores them with their node', async () => {
    const document = createInitialDocument()
    const attachment = { id: 'attachment-1', name: 'note.txt', type: 'text/plain', size: 5, createdAt: 1 }
    document.nodes[document.rootId].attachments = [attachment]
    const archive = await createWorkspaceBackup({
      documents: [document], versions: [], categories: [], tags: [],
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
  })
})
