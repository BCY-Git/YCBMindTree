import JSZip from 'jszip'
import { mindMapDocumentSchema } from '@/domain/document.schema'
import type { MindMapDocument } from '@/domain/document.types'
import { assertValidDocument } from '@/domain/document.validator'
import type { DocumentVersion, DocumentVersionKind } from '@/history/version-history'
import type { StoredAttachment } from '@/persistence/database'
import { isTauriRuntime } from '@/platform/tauri'
import type { DepositBatch, DepositProvenance } from '@/ai/deposit/deposit-types'
import { depositBatchSchema, depositProvenanceSchema } from '@/ai/deposit/deposit-persistence-schema'
import type { WorkflowSession } from '@/ai/workflow/workflow-types'
import { workflowSessionSchema } from '@/ai/workflow/workflow-schema'
import { randomUuid } from '@/platform/random-uuid'
import type { WorkspaceProject } from '@/projects/project-library'

export type WorkspaceCategory = { id: string; name: string }
export type WorkspaceTag = { id: string; name: string; color: string }

export type WorkspaceBackup = {
  documents: MindMapDocument[]
  versions: DocumentVersion[]
  attachments: StoredAttachment[]
  depositBatches: DepositBatch[]
  depositProvenance: DepositProvenance[]
  workflowSessions: WorkflowSession[]
  categories: WorkspaceCategory[]
  /** v4 起包含项目库；旧备份或旧调用方可省略。 */
  projects?: WorkspaceProject[]
  tags: WorkspaceTag[]
}

export type WorkspaceRestoreTarget = {
  documents: MindMapDocument[]
  attachmentIds: ReadonlySet<string>
  categories: WorkspaceCategory[]
  projects?: WorkspaceProject[]
  tags: WorkspaceTag[]
}

export type WorkspaceRestorePlan = WorkspaceBackup & {
  copiedDocumentCount: number
}

type AttachmentManifest = Omit<StoredAttachment, 'blob'> & { path: string }
type BackupManifest = {
  format: 'mindtree-workspace-backup'
  version: 1 | 2 | 3 | 4
  exportedAt: string
  documents: MindMapDocument[]
  versions: DocumentVersion[]
  attachments: AttachmentManifest[]
  categories: WorkspaceCategory[]
  projects?: WorkspaceProject[]
  tags: WorkspaceTag[]
  depositBatches?: DepositBatch[]
  depositProvenance?: DepositProvenance[]
  workflowSessions?: WorkflowSession[]
}

const backupFormat = 'mindtree-workspace-backup' as const

type FilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>
}

function assertCategories(value: unknown): WorkspaceCategory[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim())) {
    throw new Error('备份中的分类数据无效')
  }
  return value.map((item) => ({ id: item.id, name: item.name }))
}

function assertTags(value: unknown): WorkspaceTag[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim() || typeof item.color !== 'string' || !item.color.trim())) {
    throw new Error('备份中的标签数据无效')
  }
  return value.map((item) => ({ id: item.id, name: item.name, color: item.color }))
}

function assertProjects(value: unknown): WorkspaceProject[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim() || typeof item.description !== 'string' || typeof item.createdAt !== 'number' || typeof item.updatedAt !== 'number')) {
    throw new Error('备份中的项目数据无效')
  }
  return value.map((item) => ({ id: item.id, name: item.name.trim(), description: item.description, createdAt: item.createdAt, updatedAt: item.updatedAt }))
}

function parseDocument(value: unknown): MindMapDocument {
  const document = mindMapDocumentSchema.parse(value)
  assertValidDocument(document)
  return document
}

function parseVersions(value: unknown, documentIds: Set<string>): DocumentVersion[] {
  const kinds: DocumentVersionKind[] = ['auto', 'manual', 'restore-point', 'sync-backup']
  if (!Array.isArray(value)) throw new Error('备份中的版本历史无效')
  return value.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.documentId !== 'string' || !documentIds.has(item.documentId)
      || !kinds.includes(item.kind as DocumentVersionKind) || (item.label !== null && typeof item.label !== 'string') || typeof item.createdAt !== 'number') {
      throw new Error('备份中的版本历史无效')
    }
    const snapshot = parseDocument(item.snapshot)
    if (snapshot.id !== item.documentId) throw new Error('版本快照与导图不匹配')
    return { id: item.id, documentId: item.documentId, kind: item.kind as DocumentVersionKind, label: item.label, snapshot, createdAt: item.createdAt }
  })
}

function parseAttachmentManifest(value: unknown, documents: MindMapDocument[]): AttachmentManifest[] {
  if (!Array.isArray(value)) throw new Error('备份中的附件清单无效')
  const documentById = new Map(documents.map((document) => [document.id, document]))
  return value.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.documentId !== 'string' || typeof item.nodeId !== 'string'
      || typeof item.name !== 'string' || typeof item.type !== 'string' || typeof item.size !== 'number' || typeof item.createdAt !== 'number'
      || typeof item.path !== 'string' || !item.path.startsWith('attachments/')) {
      throw new Error('备份中的附件清单无效')
    }
    const node = documentById.get(item.documentId)?.nodes[item.nodeId]
    const listed = node?.attachments.find((attachment) => attachment.id === item.id)
    if (!listed || listed.name !== item.name || listed.type !== item.type || listed.size !== item.size) throw new Error('附件与导图内容不匹配')
    return { id: item.id, documentId: item.documentId, nodeId: item.nodeId, name: item.name, type: item.type, size: item.size, createdAt: item.createdAt, path: item.path }
  })
}

function assertAttachmentCoverage(documents: MindMapDocument[], attachmentIds: ReadonlySet<string>) {
  for (const document of documents) {
    for (const node of Object.values(document.nodes)) {
      for (const attachment of node.attachments) {
        if (!attachmentIds.has(attachment.id)) throw new Error(`备份缺少附件内容：${attachment.name}`)
      }
    }
  }
}

function parseDepositData(manifest: Partial<BackupManifest>, documents: MindMapDocument[]) {
  const documentIds = new Set(documents.map((document) => document.id))
  const depositBatches = (manifest.depositBatches ?? []).map((value) => depositBatchSchema.parse(value))
  const batchById = new Map(depositBatches.map((batch) => [batch.id, batch]))
  for (const batch of depositBatches) {
    if (!documentIds.has(batch.sourceDocumentId) || batch.candidates.some((candidate) => candidate.batchId !== batch.id)) throw new Error('备份中的沉淀批次引用无效')
  }
  const depositProvenance = (manifest.depositProvenance ?? []).map((value) => depositProvenanceSchema.parse(value))
  for (const item of depositProvenance) {
    const batch = batchById.get(item.batchId)
    if (!batch || !batch.candidates.some((candidate) => candidate.id === item.candidateId) || !documentIds.has(item.sourceDocumentId)
      || (item.targetDocumentId !== null && !documentIds.has(item.targetDocumentId))) throw new Error('备份中的沉淀来源引用无效')
  }
  return { depositBatches, depositProvenance }
}

function parseWorkflowSessions(manifest: Partial<BackupManifest>, documents: MindMapDocument[]) {
  const documentById = new Map(documents.map((document) => [document.id, document]))
  return (manifest.workflowSessions ?? []).map((value) => {
    const session = workflowSessionSchema.parse(value)
    if (!documentById.get(session.documentId)?.nodes[session.focusNodeId]) throw new Error('备份中的协作会话引用无效')
    return session
  })
}

/** 将整个工作区压缩为可迁移的 ZIP；附件保留二进制，不进入 JSON。 */
export async function createWorkspaceBackup(input: WorkspaceBackup): Promise<Blob> {
  const archive = new JSZip()
  const attachments: AttachmentManifest[] = []
  for (const attachment of input.attachments) {
    const path = `attachments/${attachment.id}`
    attachments.push({ id: attachment.id, documentId: attachment.documentId, nodeId: attachment.nodeId, name: attachment.name, type: attachment.type, size: attachment.size, createdAt: attachment.createdAt, path })
    archive.file(path, attachment.blob)
  }
  assertAttachmentCoverage(input.documents, new Set(attachments.map((attachment) => attachment.id)))
  const manifest: BackupManifest = {
    format: backupFormat,
    version: 4,
    exportedAt: new Date().toISOString(),
    documents: input.documents,
    versions: input.versions,
    attachments,
    categories: input.categories,
    projects: input.projects ?? [],
    tags: input.tags,
    depositBatches: input.depositBatches,
    depositProvenance: input.depositProvenance,
    workflowSessions: input.workflowSessions,
  }
  archive.file('manifest.json', JSON.stringify(manifest))
  return archive.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

/** 读取且严格验证工作区备份；任一文件、附件或快照损坏都会拒绝恢复。 */
export async function parseWorkspaceBackup(file: Blob): Promise<WorkspaceBackup> {
  let archive: JSZip
  try {
    archive = await JSZip.loadAsync(file)
  } catch {
    throw new Error('备份文件不是有效的 ZIP 压缩包')
  }
  const manifestFile = archive.file('manifest.json')
  if (!manifestFile) throw new Error('备份文件缺少 manifest.json')
  let raw: unknown
  try {
    raw = JSON.parse(await manifestFile.async('string'))
  } catch {
    throw new Error('备份清单不是有效 JSON')
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('不是受支持的 MindTree 工作区备份')
  }
  const manifest = raw as Partial<BackupManifest>
  if (manifest.format !== backupFormat || ![1, 2, 3, 4].includes(manifest.version ?? 0) || !Array.isArray(manifest.documents)) {
    throw new Error('不是受支持的 MindTree 工作区备份')
  }
  const documents = manifest.documents.map(parseDocument)
  const documentIds = new Set(documents.map((document) => document.id))
  if (documentIds.size !== documents.length) throw new Error('备份中含有重复导图 ID')
  const versions = parseVersions(manifest.versions, documentIds)
  const categories = assertCategories(manifest.categories)
  const projects = manifest.projects === undefined ? [] : assertProjects(manifest.projects)
  const tags = assertTags(manifest.tags)
  const manifests = parseAttachmentManifest(manifest.attachments, documents)
  assertAttachmentCoverage(documents, new Set(manifests.map((attachment) => attachment.id)))
  const attachments = await Promise.all(manifests.map(async (attachment) => {
    const binary = archive.file(attachment.path)
    if (!binary) throw new Error(`备份缺少附件：${attachment.name}`)
    return { ...attachment, blob: await binary.async('blob') }
  }))
  const deposit = parseDepositData(manifest, documents)
  return { documents, versions, attachments, categories, projects, tags, ...deposit, workflowSessions: parseWorkflowSessions(manifest, documents) }
}

function backupFileName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return `MindTree工作区备份_${timestamp}.mindtree-backup.zip`
}

/** 将完整工作区备份保存到用户选定位置；浏览器降级为下载，桌面端调用原生保存窗口。 */
export async function saveWorkspaceBackupToLocalFile(input: WorkspaceBackup): Promise<'native' | 'picker' | 'download'> {
  const content = await createWorkspaceBackup(input)
  const suggestedName = backupFileName()
  if (isTauriRuntime()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ])
    const path = await save({ title: '保存 MindTree 工作区备份', defaultPath: suggestedName, filters: [{ name: 'MindTree 工作区备份', extensions: ['zip'] }] })
    if (!path) throw new DOMException('用户取消保存', 'AbortError')
    await writeFile(path, new Uint8Array(await content.arrayBuffer()))
    return 'native'
  }
  const picker = (window as FilePickerWindow).showSaveFilePicker
  if (picker) {
    const handle = await picker({
      suggestedName,
      types: [{ description: 'MindTree 工作区备份', accept: { 'application/zip': ['.mindtree-backup.zip', '.zip'] } }],
    })
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
    return 'picker'
  }
  const url = URL.createObjectURL(content)
  const link = window.document.createElement('a')
  link.href = url
  link.download = suggestedName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return 'download'
}

function mapCategories(imported: WorkspaceCategory[], existing: WorkspaceCategory[]) {
  const result = structuredClone(existing)
  const ids = new Set(result.map((item) => item.id))
  const mapping = new Map<string, string>()
  for (const item of imported) {
    const sameId = result.find((current) => current.id === item.id)
    const sameName = result.find((current) => current.name === item.name)
    if (sameId && sameId.name === item.name) mapping.set(item.id, sameId.id)
    else if (sameName) mapping.set(item.id, sameName.id)
    else {
      const id = ids.has(item.id) ? `category-${randomUuid()}` : item.id
      result.push({ ...item, id })
      ids.add(id)
      mapping.set(item.id, id)
    }
  }
  return { categories: result, mapping }
}

function mapTags(imported: WorkspaceTag[], existing: WorkspaceTag[]) {
  const result = structuredClone(existing)
  const ids = new Set(result.map((item) => item.id))
  const mapping = new Map<string, string>()
  for (const item of imported) {
    const sameId = result.find((current) => current.id === item.id)
    const sameName = result.find((current) => current.name === item.name)
    if (sameId && sameId.name === item.name && sameId.color === item.color) mapping.set(item.id, sameId.id)
    else if (sameName) mapping.set(item.id, sameName.id)
    else {
      const id = ids.has(item.id) ? `tag-${randomUuid()}` : item.id
      result.push({ ...item, id })
      ids.add(id)
      mapping.set(item.id, id)
    }
  }
  return { tags: result, mapping }
}

function mapProjects(imported: WorkspaceProject[], existing: WorkspaceProject[]) {
  const result = structuredClone(existing)
  const ids = new Set(result.map((item) => item.id))
  const mapping = new Map<string, string>()
  for (const item of imported) {
    const sameId = result.find((current) => current.id === item.id)
    const sameName = result.find((current) => current.name === item.name)
    if (sameId && sameId.name === item.name) mapping.set(item.id, sameId.id)
    else if (sameName) mapping.set(item.id, sameName.id)
    else {
      const id = ids.has(item.id) ? `project-${randomUuid()}` : item.id
      result.push({ ...item, id })
      ids.add(id)
      mapping.set(item.id, id)
    }
  }
  return { projects: result, mapping }
}

/**
 * 将外部工作区变成可安全合并的恢复计划。
 * 已存在的导图变成“恢复副本”；所有附件和版本都分配新 ID，避免跨工作区串联。
 */
export function prepareWorkspaceRestore(backup: WorkspaceBackup, target: WorkspaceRestoreTarget, now = Date.now()): WorkspaceRestorePlan {
  const existingDocumentIds = new Set(target.documents.map((document) => document.id))
  const documentIdMap = new Map<string, string>()
  const copiedIds = new Set<string>()
  for (const document of backup.documents) {
    const collision = existingDocumentIds.has(document.id)
    documentIdMap.set(document.id, collision ? randomUuid() : document.id)
    if (collision) copiedIds.add(document.id)
  }
  const attachmentIdMap = new Map(backup.attachments.map((attachment) => [attachment.id, randomUuid()]))
  const { categories, mapping: categoryIds } = mapCategories(backup.categories, target.categories)
  const { projects, mapping: projectIds } = mapProjects(backup.projects ?? [], target.projects ?? [])
  const { tags, mapping: tagIds } = mapTags(backup.tags, target.tags)

  const rewriteDocument = (source: MindMapDocument, updateTimestamp: boolean) => {
    const document = structuredClone(source)
    const isCopy = copiedIds.has(source.id)
    document.id = documentIdMap.get(source.id) ?? source.id
    document.categoryId = categoryIds.get(source.categoryId) ?? source.categoryId
    // 项目库缺失时宁可回退为未归属，避免恢复后出现无法管理的悬空项目。
    document.projectId = source.projectId ? projectIds.get(source.projectId) ?? null : null
    if (isCopy) document.title = `${document.title}（恢复副本）`
    if (updateTimestamp) document.updatedAt = now
    for (const node of Object.values(document.nodes)) {
      node.tagIds = node.tagIds.map((id) => tagIds.get(id) ?? id)
      node.attachments = node.attachments.map((attachment) => ({ ...attachment, id: attachmentIdMap.get(attachment.id) ?? attachment.id }))
    }
    return document
  }

  const documents = backup.documents.map((document) => rewriteDocument(document, true))
  const versions = backup.versions.map((version) => ({
    ...structuredClone(version),
    id: randomUuid(),
    documentId: documentIdMap.get(version.documentId) ?? version.documentId,
    snapshot: rewriteDocument(version.snapshot, false),
  }))
  const attachments = backup.attachments.map((attachment) => ({
    ...attachment,
    id: attachmentIdMap.get(attachment.id) ?? attachment.id,
    documentId: documentIdMap.get(attachment.documentId) ?? attachment.documentId,
  }))
  const batchIdMap = new Map(backup.depositBatches.map((batch) => [batch.id, randomUuid()]))
  const candidateIdMap = new Map(backup.depositBatches.flatMap((batch) => batch.candidates.map((candidate) => [candidate.id, randomUuid()] as const)))
  const depositBatches = backup.depositBatches.map((source) => {
    const batchId = batchIdMap.get(source.id) ?? source.id
    return {
      ...structuredClone(source),
      id: batchId,
      sourceDocumentId: documentIdMap.get(source.sourceDocumentId) ?? source.sourceDocumentId,
      candidates: source.candidates.map((candidate) => ({
        ...structuredClone(candidate),
        id: candidateIdMap.get(candidate.id) ?? candidate.id,
        batchId,
        suggestedDocumentId: candidate.suggestedDocumentId ? documentIdMap.get(candidate.suggestedDocumentId) ?? candidate.suggestedDocumentId : null,
        duplicateOfCandidateId: candidate.duplicateOfCandidateId ? candidateIdMap.get(candidate.duplicateOfCandidateId) ?? null : null,
      })),
    }
  })
  const depositProvenance = backup.depositProvenance.map((source) => ({
    ...structuredClone(source),
    id: randomUuid(),
    batchId: batchIdMap.get(source.batchId) ?? source.batchId,
    candidateId: candidateIdMap.get(source.candidateId) ?? source.candidateId,
    sourceDocumentId: documentIdMap.get(source.sourceDocumentId) ?? source.sourceDocumentId,
    targetDocumentId: source.targetDocumentId ? documentIdMap.get(source.targetDocumentId) ?? source.targetDocumentId : null,
  }))
  const workflowSessions = backup.workflowSessions.map((source) => ({ ...structuredClone(source), id: randomUuid(), documentId: documentIdMap.get(source.documentId) ?? source.documentId }))
  return { documents, versions, attachments, categories, projects, tags, depositBatches, depositProvenance, workflowSessions, copiedDocumentCount: copiedIds.size }
}
