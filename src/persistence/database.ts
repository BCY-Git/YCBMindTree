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
import type { DepositBatch, DepositProvenance } from '../ai/deposit/deposit-types'
import type { DepositPlan, DepositWorkspaceTransaction } from '../ai/deposit/deposit-types'
import { executeCommand } from '../domain/commands'
import type { WorkflowSession } from '../ai/workflow/workflow-types'
import { workflowSessionSchema } from '../ai/workflow/workflow-schema'

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

export type DepositMetricEvent = {
  id: string
  documentId: string
  batchId: string
  referenceId?: string
  type: 'generated' | 'accepted' | 'ignored' | 'target-reselected' | 'modified' | 'duplicate' | 'applied' | 'failed' | 'confirmation-duration' | 'revisited'
  value: number
  createdAt: number
}

export class MindTreeDatabase extends Dexie {
  documents!: EntityTable<MindMapDocument, 'id'>
  syncMetadata!: EntityTable<SyncMetadata, 'documentId'>
  documentVersions!: EntityTable<DocumentVersion, 'id'>
  attachments!: EntityTable<StoredAttachment, 'id'>
  depositBatches!: EntityTable<DepositBatch, 'id'>
  depositProvenance!: EntityTable<DepositProvenance, 'id'>
  depositWorkspaceTransactions!: EntityTable<DepositWorkspaceTransaction, 'id'>
  workflowSessions!: EntityTable<WorkflowSession, 'id'>
  depositMetrics!: EntityTable<DepositMetricEvent, 'id'>

  constructor(name = 'mindtree') {
    super(name)
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
    this.version(5).stores({
      documents: 'id, title, updatedAt',
      syncMetadata: 'documentId, syncedAt',
      documentVersions: 'id, documentId, createdAt, [documentId+createdAt], kind',
      attachments: 'id, documentId, nodeId, createdAt',
      depositBatches: 'id, sourceDocumentId, status, createdAt, updatedAt',
      depositProvenance: 'id, batchId, candidateId, sourceDocumentId, createdAt',
    })
    this.version(6).stores({
      documents: 'id, title, updatedAt',
      syncMetadata: 'documentId, syncedAt',
      documentVersions: 'id, documentId, createdAt, [documentId+createdAt], kind',
      attachments: 'id, documentId, nodeId, createdAt',
      depositBatches: 'id, sourceDocumentId, status, createdAt, updatedAt',
      depositProvenance: 'id, batchId, candidateId, sourceDocumentId, createdAt',
      depositWorkspaceTransactions: 'id, batchId, status, createdAt',
    })
    this.version(7).stores({
      documents: 'id, title, updatedAt', syncMetadata: 'documentId, syncedAt', documentVersions: 'id, documentId, createdAt, [documentId+createdAt], kind', attachments: 'id, documentId, nodeId, createdAt',
      depositBatches: 'id, sourceDocumentId, status, createdAt, updatedAt', depositProvenance: 'id, batchId, candidateId, sourceDocumentId, createdAt', depositWorkspaceTransactions: 'id, batchId, status, createdAt',
      workflowSessions: 'id, documentId, focusNodeId, status, updatedAt',
    })
    this.version(8).stores({
      documents: 'id, title, updatedAt', syncMetadata: 'documentId, syncedAt', documentVersions: 'id, documentId, createdAt, [documentId+createdAt], kind', attachments: 'id, documentId, nodeId, createdAt',
      depositBatches: 'id, sourceDocumentId, status, createdAt, updatedAt', depositProvenance: 'id, batchId, candidateId, sourceDocumentId, createdAt', depositWorkspaceTransactions: 'id, batchId, status, createdAt', workflowSessions: 'id, documentId, focusNodeId, status, updatedAt',
      depositMetrics: 'id, documentId, batchId, type, createdAt',
    })
    this.version(9).stores({
      documents: 'id, title, updatedAt', syncMetadata: 'documentId, syncedAt', documentVersions: 'id, documentId, createdAt, [documentId+createdAt], kind', attachments: 'id, documentId, nodeId, createdAt',
      depositBatches: 'id, sourceDocumentId, status, createdAt, updatedAt', depositProvenance: 'id, batchId, candidateId, sourceDocumentId, targetDocumentId, *targetNodeIds, createdAt', depositWorkspaceTransactions: 'id, batchId, status, createdAt', workflowSessions: 'id, documentId, focusNodeId, status, updatedAt',
      depositMetrics: 'id, documentId, batchId, type, createdAt',
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

/** 智能沉淀的候选与来源独立保存，不污染导图 JSON 或普通导出格式。 */
export async function saveDepositBatch(batch: DepositBatch): Promise<void> {
  await database.depositBatches.put(batch)
}

export async function listDepositBatches(sourceDocumentId: string): Promise<DepositBatch[]> {
  const batches = await database.depositBatches.where('sourceDocumentId').equals(sourceDocumentId).toArray()
  return batches.sort((left, right) => right.updatedAt - left.updatedAt)
}

export async function listAllDepositBatches(): Promise<DepositBatch[]> {
  return database.depositBatches.toArray()
}

export async function listAllDepositProvenance(): Promise<DepositProvenance[]> {
  return database.depositProvenance.toArray()
}

export async function listWorkflowSessions(documentId: string): Promise<WorkflowSession[]> {
  const sessions = await database.workflowSessions.where('documentId').equals(documentId).toArray()
  return sessions.map((session) => workflowSessionSchema.parse(session)).sort((left, right) => right.updatedAt - left.updatedAt)
}

export async function listAllWorkflowSessions(): Promise<WorkflowSession[]> {
  return (await database.workflowSessions.toArray()).map((session) => workflowSessionSchema.parse(session))
}

export async function saveWorkflowSession(session: WorkflowSession): Promise<void> {
  await database.workflowSessions.put(workflowSessionSchema.parse(session))
}

/** 只记录本地聚合所需事件，不保存节点原文、候选标题或模型回复。 */
export async function recordDepositMetric(event: Omit<DepositMetricEvent, 'id' | 'createdAt'>, target = database): Promise<void> {
  await target.depositMetrics.put({ ...event, id: crypto.randomUUID(), createdAt: Date.now() })
}

export async function getDepositMetricSummary(documentId: string, source = database): Promise<Record<DepositMetricEvent['type'], number>> {
  const events = await source.depositMetrics.where('documentId').equals(documentId).toArray()
  const summary: Record<DepositMetricEvent['type'], number> = { generated: 0, accepted: 0, ignored: 0, 'target-reselected': 0, modified: 0, duplicate: 0, applied: 0, failed: 0, 'confirmation-duration': 0, revisited: 0 }
  events.forEach((event) => { summary[event.type] += event.value })
  return summary
}

export async function recordDepositMetricOnce(event: Omit<DepositMetricEvent, 'id' | 'createdAt'>, target = database): Promise<void> {
  await target.transaction('rw', target.depositMetrics, async () => {
    const existing = (await target.depositMetrics.where('batchId').equals(event.batchId).toArray())
      .some((item) => item.type === event.type && item.referenceId === event.referenceId)
    if (!existing) await recordDepositMetric(event, target)
  })
}

/** 将用户再次选中已沉淀目标视为一次复用；同一来源记录只计一次。 */
export async function markDepositTargetRevisited(documentId: string, nodeId: string, target = database): Promise<void> {
  const provenance = (await target.depositProvenance.where('targetNodeIds').equals(nodeId).toArray())
    .filter((item) => item.targetDocumentId === documentId)
  await Promise.all(provenance.map((item) => recordDepositMetricOnce({ documentId, batchId: item.batchId, referenceId: item.id, type: 'revisited', value: 1 }, target)))
}

export async function listAppliedDepositFingerprints(sourceDocumentId: string): Promise<string[]> {
  const batches = await database.depositBatches.where('sourceDocumentId').equals(sourceDocumentId).toArray()
  return batches.flatMap((batch) => batch.candidates.filter((candidate) => candidate.status === 'applied').map((candidate) => candidate.fingerprint))
}

export async function applyDepositBatch(batch: DepositBatch, provenance: DepositProvenance[]): Promise<DepositBatch> {
  const now = Date.now()
  const applied: DepositBatch = {
    ...batch,
    status: 'applied',
    updatedAt: now,
    appliedAt: now,
    candidates: batch.candidates.map((candidate) => candidate.status === 'accepted' ? { ...candidate, status: 'applied' } : candidate),
  }
  await database.transaction('rw', database.depositBatches, database.depositProvenance, async () => {
    await database.depositBatches.put(applied)
    if (provenance.length) await database.depositProvenance.bulkPut(provenance)
  })
  return applied
}

function appliedBatch(batch: DepositBatch, now = Date.now()): DepositBatch {
  return {
    ...batch,
    status: 'applied',
    updatedAt: now,
    appliedAt: now,
    candidates: batch.candidates.map((candidate) => candidate.status === 'accepted' ? { ...candidate, status: 'applied' } : candidate),
  }
}

/**
 * 跨导图沉淀在单个 Dexie 事务中完成：版本检查、所有导图写入、批次状态、来源与撤销快照。
 */
export async function applyWorkspaceDepositPlan(plan: DepositPlan, batch: DepositBatch, model: string): Promise<{ documents: MindMapDocument[]; batch: DepositBatch }> {
  const documentIds = Object.keys(plan.expectedDocumentUpdatedAt)
  return database.transaction('rw', [database.documents, database.depositBatches, database.depositProvenance, database.depositWorkspaceTransactions], async () => {
    const loaded = await database.documents.bulkGet(documentIds)
    const documents = new Map<string, MindMapDocument>()
    loaded.forEach((document, index) => {
      if (!document) throw new Error('沉淀目标导图已被删除')
      const parsed = parseStoredDocument(document)
      if (parsed.updatedAt !== plan.expectedDocumentUpdatedAt[parsed.id]) throw new Error(`导图「${parsed.title}」在预览后已发生变化`)
      documents.set(parsed.id, parsed)
    })
    const beforeDocuments = documentIds.map((id) => structuredClone(documents.get(id)!))
    const afterDocuments = documentIds.map((documentId) => {
      const document = documents.get(documentId)!
      const operations = plan.operations.filter((item) => item.documentId === documentId).map((item) => item.operation)
      return operations.length ? executeCommand(document, { type: 'APPLY_DEPOSIT_OPERATIONS', batchId: batch.id, operations }).document : structuredClone(document)
    })
    const afterById = new Map(afterDocuments.map((document) => [document.id, document]))
    const beforeById = new Map(beforeDocuments.map((document) => [document.id, document]))
    const claimedCreatedNodes = new Set<string>()
    const accepted = batch.candidates.filter((candidate) => plan.includedCandidateIds.includes(candidate.id))
    const provenance: DepositProvenance[] = accepted.map((candidate) => {
      const planned = plan.operations.find((item) => item.candidateId === candidate.id)
      let targetNodeId: string | null = null
      if (planned?.operation.type === 'CREATE_BRANCH') {
        const before = beforeById.get(planned.documentId)!
        const after = afterById.get(planned.documentId)!
        targetNodeId = after.nodes[planned.operation.parentId]?.childIds.find((id) => !before.nodes[id] && !claimedCreatedNodes.has(id) && after.nodes[id]?.topic === candidate.title) ?? null
        if (targetNodeId) claimedCreatedNodes.add(targetNodeId)
      } else if (planned && 'nodeId' in planned.operation) targetNodeId = planned.operation.nodeId
      return { id: crypto.randomUUID(), batchId: batch.id, candidateId: candidate.id, sourceDocumentId: batch.sourceDocumentId, sourceNodeIds: candidate.sourceNodeIds, sourceSnapshot: batch.sourceSnapshot, targetDocumentId: planned?.documentId ?? null, targetNodeIds: targetNodeId ? [targetNodeId] : [], action: candidate.action, model, acceptedByUser: true, createdAt: Date.now() }
    })
    const completed = appliedBatch(batch)
    const transaction: DepositWorkspaceTransaction = { id: crypto.randomUUID(), batchId: batch.id, beforeDocuments, afterDocuments, status: 'applied', createdAt: Date.now(), revertedAt: null }
    await database.documents.bulkPut(afterDocuments)
    await database.depositBatches.put(completed)
    if (provenance.length) await database.depositProvenance.bulkPut(provenance)
    await database.depositWorkspaceTransactions.put(transaction)
    return { documents: afterDocuments, batch: completed }
  })
}

export async function revertWorkspaceDepositBatch(batchId: string): Promise<{ documents: MindMapDocument[]; batch: DepositBatch }> {
  return database.transaction('rw', [database.documents, database.depositBatches, database.depositWorkspaceTransactions], async () => {
    const transaction = await database.depositWorkspaceTransactions.where('batchId').equals(batchId).last()
    if (!transaction || transaction.status !== 'applied') throw new Error('找不到可撤销的跨导图沉淀')
    const current = await database.documents.bulkGet(transaction.afterDocuments.map((document) => document.id))
    current.forEach((document, index) => {
      const expected = transaction.afterDocuments[index]
      if (!document || document.updatedAt !== expected.updatedAt) throw new Error(`导图「${expected.title}」已继续修改，无法安全整体撤销`)
    })
    const batch = await database.depositBatches.get(batchId)
    if (!batch) throw new Error('沉淀批次不存在')
    const revertedBatch: DepositBatch = { ...batch, status: 'pending', appliedAt: null, updatedAt: Date.now(), candidates: batch.candidates.map((candidate) => candidate.status === 'applied' ? { ...candidate, status: 'accepted' } : candidate) }
    await database.documents.bulkPut(transaction.beforeDocuments)
    await database.depositBatches.put(revertedBatch)
    await database.depositWorkspaceTransactions.put({ ...transaction, status: 'reverted', revertedAt: Date.now() })
    return { documents: transaction.beforeDocuments, batch: revertedBatch }
  })
}

/** 与编辑器撤销/重做联动；来源记录保留历史，是否生效由批次和候选状态表示。 */
export async function setDepositBatchAppliedState(batchId: string, applied: boolean): Promise<void> {
  await database.transaction('rw', database.depositBatches, async () => {
    const batch = await database.depositBatches.get(batchId)
    if (!batch) return
    const now = Date.now()
    await database.depositBatches.put({
      ...batch,
      status: applied ? 'applied' : 'pending',
      appliedAt: applied ? now : null,
      updatedAt: now,
      candidates: batch.candidates.map((candidate) => {
        if (!applied && candidate.status === 'applied') return { ...candidate, status: 'accepted' }
        if (applied && candidate.status === 'accepted') return { ...candidate, status: 'applied' }
        return candidate
      }),
    })
  })
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

/** 删除当前导图已不再引用的 Blob；覆盖附件移除、分支删除和导图内容替换。 */
export async function pruneStoredAttachmentsForDocument(document: MindMapDocument, target = database): Promise<number> {
  const referencedIds = new Set(Object.values(document.nodes).flatMap((node) => node.attachments.map((attachment) => attachment.id)))
  const versions = await target.documentVersions.where('documentId').equals(document.id).toArray()
  versions.forEach((version) => Object.values(version.snapshot.nodes).forEach((node) => node.attachments.forEach((attachment) => referencedIds.add(attachment.id))))
  const stored = await target.attachments.where('documentId').equals(document.id).toArray()
  const orphanIds = stored.filter((attachment) => !referencedIds.has(attachment.id)).map((attachment) => attachment.id)
  if (orphanIds.length) await target.attachments.bulkDelete(orphanIds)
  return orphanIds.length
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
export async function restoreWorkspaceData(data: { documents: MindMapDocument[]; versions: DocumentVersion[]; attachments: StoredAttachment[]; depositBatches: DepositBatch[]; depositProvenance: DepositProvenance[]; workflowSessions: WorkflowSession[] }): Promise<void> {
  await database.transaction('rw', [database.documents, database.documentVersions, database.attachments, database.syncMetadata, database.depositBatches, database.depositProvenance, database.workflowSessions], async () => {
    await database.documents.bulkPut(data.documents)
    await database.documentVersions.bulkPut(data.versions)
    await database.attachments.bulkPut(data.attachments)
    await database.depositBatches.bulkPut(data.depositBatches)
    await database.depositProvenance.bulkPut(data.depositProvenance)
    await database.workflowSessions.bulkPut(data.workflowSessions)
    await database.syncMetadata.bulkDelete(data.documents.map((document) => document.id))
  })
}
