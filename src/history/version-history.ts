import type { MindMapDocument } from '../domain/document.types'
import { randomUuid } from '../platform/random-uuid'

export type DocumentVersionKind = 'auto' | 'manual' | 'restore-point' | 'sync-backup'

export type DocumentVersion = {
  id: string
  documentId: string
  kind: DocumentVersionKind
  label: string | null
  snapshot: MindMapDocument
  createdAt: number
}

export function createDocumentVersion(document: MindMapDocument, kind: DocumentVersionKind, label: string | null = null): DocumentVersion {
  return {
    id: randomUuid(),
    documentId: document.id,
    kind,
    label,
    snapshot: structuredClone(document),
    createdAt: Date.now(),
  }
}

/** 恢复历史版本时沿用当前导图 ID，让同步和侧栏记录仍指向同一份导图。 */
export function restoreDocumentVersion(version: DocumentVersion, current: MindMapDocument): MindMapDocument {
  const restored = structuredClone(version.snapshot)
  return {
    ...restored,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: Date.now(),
  }
}

/** 历史版本另存为副本：新建 ID，绝不影响当前导图与云端版本。 */
export function duplicateDocumentVersion(version: DocumentVersion): MindMapDocument {
  const now = Date.now()
  const duplicate = structuredClone(version.snapshot)
  return {
    ...duplicate,
    id: randomUuid(),
    title: `${duplicate.title}（历史副本）`,
    createdAt: now,
    updatedAt: now,
  }
}
