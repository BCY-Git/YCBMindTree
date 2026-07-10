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
import type { MindMapDocument } from '../domain/document.types'
import { assertValidDocument } from '../domain/document.validator'

class MindTreeDatabase extends Dexie {
  documents!: EntityTable<MindMapDocument, 'id'>

  constructor() {
    super('mindtree')
    this.version(1).stores({ documents: 'id, title, updatedAt' })
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
