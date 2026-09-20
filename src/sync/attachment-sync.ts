/**
 * attachment-sync — 附件字节随云端同步的编排。
 *
 * 文档快照（元数据）与附件字节分开传输：
 * - push：先推文档结构，再补传远端缺失的字节（HEAD 探测，幂等）
 * - pull：落地远端快照后，把本地缺失的字节拉下来存进 IndexedDB
 * - 懒加载兜底：界面渲染时发现本地没有字节，可单独拉取（resolveAttachmentBlob）
 */
import type { MindMapDocument, MindNodeAttachment } from '@/domain/document.types'
import { getNodeAttachment, storeAttachmentBlob } from '@/persistence/database'
import { useEditorStore } from '@/store/editor.store'
import { fetchRemoteAttachment, loadSyncConfig, remoteAttachmentExists, uploadAttachment, type SyncConfig } from './sync-client'

export type DocumentAttachmentRef = { meta: MindNodeAttachment; nodeId: string }

/** 收集整份导图的附件元数据及其所在节点。 */
export function collectDocumentAttachments(document: MindMapDocument): DocumentAttachmentRef[] {
  const refs: DocumentAttachmentRef[] = []
  for (const node of Object.values(document.nodes)) {
    for (const meta of node.attachments) refs.push({ meta, nodeId: node.id })
  }
  return refs
}

export type AttachmentSyncResult = { transferred: number; skipped: number; failed: number }

/** push 成功后调用：把远端缺失的附件字节补传上去。逐个尝试，单个失败不中断整体。 */
export async function uploadMissingAttachments(config: SyncConfig, document: MindMapDocument): Promise<AttachmentSyncResult> {
  const result: AttachmentSyncResult = { transferred: 0, skipped: 0, failed: 0 }
  for (const { meta } of collectDocumentAttachments(document)) {
    try {
      if (await remoteAttachmentExists(config, document.id, meta.id)) { result.skipped += 1; continue }
      const stored = await getNodeAttachment(meta.id)
      if (!stored?.blob) { result.skipped += 1; continue }
      await uploadAttachment(config, document.id, meta, stored.blob)
      result.transferred += 1
    } catch {
      result.failed += 1
    }
  }
  return result
}

/** pull 落地后调用：把本地缺失的附件字节拉进 IndexedDB。 */
export async function downloadMissingAttachments(config: SyncConfig, document: MindMapDocument): Promise<AttachmentSyncResult> {
  const result: AttachmentSyncResult = { transferred: 0, skipped: 0, failed: 0 }
  for (const { meta, nodeId } of collectDocumentAttachments(document)) {
    try {
      const local = await getNodeAttachment(meta.id)
      if (local?.blob) { result.skipped += 1; continue }
      const blob = await fetchRemoteAttachment(config, document.id, meta.id)
      if (!blob) { result.skipped += 1; continue }
      await storeAttachmentBlob(document.id, nodeId, meta, blob)
      result.transferred += 1
    } catch {
      result.failed += 1
    }
  }
  return result
}

/** 懒加载兜底：本地没有字节时按附件 id 从云端拉取并写入本机。 */
export async function fetchAttachmentToLocal(config: SyncConfig, documentId: string, meta: MindNodeAttachment, nodeId: string): Promise<Blob | null> {
  const blob = await fetchRemoteAttachment(config, documentId, meta.id)
  if (!blob) return null
  await storeAttachmentBlob(documentId, nodeId, meta, blob)
  return blob
}

/** 渲染层统一入口：先查本机 IndexedDB，缺失时再走已配置的云端同步服务拉取。 */
export async function resolveAttachmentBlob(meta: MindNodeAttachment): Promise<Blob | null> {
  const stored = await getNodeAttachment(meta.id)
  if (stored?.blob) return stored.blob
  const config = loadSyncConfig()
  if (!config.token.trim()) return null
  const document = useEditorStore.getState().document
  const nodeId = Object.values(document.nodes).find((node) => node.attachments.some((item) => item.id === meta.id))?.id
  if (!nodeId) return null
  return fetchAttachmentToLocal(config, document.id, meta, nodeId).catch(() => null)
}
