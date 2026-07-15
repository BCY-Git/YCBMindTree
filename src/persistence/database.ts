/**
 * IndexedDB 持久化层 — 基于 Dexie.js。
 *
 * 负责将 MindMapDocument 存入 IndexedDB（表名 'documents'），
 * 并按 updatedAt 倒序查找最近修改的文档用于恢复。
 *
 * `loadLatestDocument()` — 取出 updatedAt 最大的一条记录，
 *   用 Zod schema 校验后返回；无记录时返回 undefined。
 * `saveDocument(document)` — 全量覆盖写入（upsert），
 *   每次文档修改后自动调用。
 *
 * 注意：目前仅支持单导图（所有记录共享同一张表），
 * 未来可扩展为按文档 id 索引列表。
 */
import Dexie, { type EntityTable } from 'dexie'
import { mindMapDocumentSchema } from '../domain/document.schema'
import type { MindMapDocument, MindNodeAttachment } from '../domain/document.types'
import { assertValidDocument } from '../domain/document.validator'
import type { DocumentVersion, DocumentVersionKind } from '../history/version-history'

export type SyncMetadata = {
  documentId: string
  remoteVersion: number
  syncedAt: number
}

export type StoredAttachment = MindNodeAttachment & {
  documentId: string
  nodeId: string
  blob: Blob
}

class MindTreeDatabase extends Dexie {
  documents!: EntityTable<MindMapDocument, 'id'>
  syncMetadata!: EntityTable<SyncMetadata, 'documentId'>
  documentVersions!: EntityTable<DocumentVersion, 'id'>
  attachments!: EntityTable<StoredAttachment, 'id'>

  constructor() {
    super('mindtree')
    this.version(1).stores({ documents: 'id, title, updatedAt' })
    this.version(2).stores({ documents: 'id, title, updatedAt', syncMetadata: 'documentId, syncedAt' })
    this.version(3).stores({
      documents: 'id, title, updatedAt',
      syncMetadata: 'documentId, syncedAt',
      documentVersions: 'id, documentId, createdAt, [documentId+createdAt], kind',
    })
    this.version(4).stores({
      documents: 'id, title, updatedAt',
      syncMetadata: 'documentId, syncedAt',
      documentVersions: 'id, documentId, createdAt, [documentId+createdAt], kind',
      attachments: 'id, documentId, nodeId, createdAt',
    })
  }
}

const database = new MindTreeDatabase()

function parseStoredDocument(value: unknown): MindMapDocument {
  const document = mindMapDocumentSchema.parse(value)
  assertValidDocument(document)
  return document
}

export async function loadLatestDocument(): Promise<MindMapDocument | undefined> {
  const latest = await database.documents.orderBy('updatedAt').last()
  return latest ? parseStoredDocument(latest) : undefined
}

export async function listDocuments(): Promise<MindMapDocument[]> {
  const documents = await database.documents.orderBy('updatedAt').reverse().toArray()
  return documents.map(parseStoredDocument)
}

export async function saveDocument(document: MindMapDocument): Promise<void> {
  await database.documents.put(document)
}

/** 每张导图保留有限的自动版本；手动快照、恢复点和同步备份不会被自动清理。 */
export async function saveDocumentVersion(version: DocumentVersion, autoVersionLimit = 30): Promise<void> {
  await database.transaction('rw', database.documentVersions, async () => {
    await database.documentVersions.put(version)
    if (version.kind !== 'auto') return
    const automatic = (await database.documentVersions.where('documentId').equals(version.documentId).toArray())
      .filter((item) => item.kind === 'auto')
      .sort((left, right) => right.createdAt - left.createdAt)
    const obsoleteIds = automatic.slice(autoVersionLimit).map((item) => item.id)
    if (obsoleteIds.length) await database.documentVersions.bulkDelete(obsoleteIds)
  })
}

export async function listDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
  const versions = await database.documentVersions.where('documentId').equals(documentId).toArray()
  return versions.sort((left, right) => right.createdAt - left.createdAt)
}

/** 工作区备份使用：读取全部版本历史，而非仅当前导图。 */
export async function listAllDocumentVersions(): Promise<DocumentVersion[]> {
  return database.documentVersions.toArray()
}

export async function deleteDocumentVersions(documentId: string, kinds?: DocumentVersionKind[]): Promise<void> {
  const versions = await database.documentVersions.where('documentId').equals(documentId).toArray()
  const ids = versions.filter((version) => !kinds || kinds.includes(version.kind)).map((version) => version.id)
  if (ids.length) await database.documentVersions.bulkDelete(ids)
}

/** 附件文件本体只留在当前浏览器，云同步的导图快照不会携带 Blob。 */
export async function saveNodeAttachment(documentId: string, nodeId: string, file: File): Promise<MindNodeAttachment> {
  const attachment: MindNodeAttachment = {
    id: crypto.randomUUID(),
    name: file.name || '未命名附件',
    type: file.type,
    size: file.size,
    createdAt: Date.now(),
  }
  await database.attachments.put({ ...attachment, documentId, nodeId, blob: file })
  return attachment
}

export async function getNodeAttachment(attachmentId: string): Promise<StoredAttachment | undefined> {
  return database.attachments.get(attachmentId)
}

/** 工作区备份使用：读取全部附件，再由调用方按导图中的附件引用过滤。 */
export async function listStoredAttachments(): Promise<StoredAttachment[]> {
  return database.attachments.toArray()
}

export async function getSyncMetadata(documentId: string): Promise<SyncMetadata | undefined> {
  return database.syncMetadata.get(documentId)
}

export async function saveSyncMetadata(metadata: SyncMetadata): Promise<void> {
  await database.syncMetadata.put(metadata)
}

/** 导入文件没有可信的远端版本号；清理旧绑定，避免以错误 baseVersion 覆盖云端。 */
export async function deleteSyncMetadata(documentId: string): Promise<void> {
  await database.syncMetadata.delete(documentId)
}

/**
 * 写入已完成 ID 重映射的工作区恢复计划。
 * 该操作是单个 IndexedDB 事务，失败时不会出现“导图已恢复但附件未恢复”的半完成状态。
 */
export async function restoreWorkspaceData(data: { documents: MindMapDocument[]; versions: DocumentVersion[]; attachments: StoredAttachment[] }): Promise<void> {
  await database.transaction('rw', database.documents, database.documentVersions, database.attachments, database.syncMetadata, async () => {
    await database.documents.bulkPut(data.documents)
    await database.documentVersions.bulkPut(data.versions)
    await database.attachments.bulkPut(data.attachments)
    await database.syncMetadata.bulkDelete(data.documents.map((document) => document.id))
  })
}
