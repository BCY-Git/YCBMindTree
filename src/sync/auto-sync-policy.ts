/**
 * auto-sync-policy — 自动同步的决策逻辑（纯函数，便于测试）。
 *
 * 触发方（App 的定时器/聚焦监听/打开文档）拿到远端记录与本地同步元数据后，
 * 由这里决定做什么；任何情况下都不允许静默覆盖本地未上传的工作。
 */

export type SyncMetadataSnapshot = { remoteVersion: number; syncedAt: number } | null

export type AutoSyncDecision = 'pull' | 'push' | 'conflict' | 'none'

/** 本地在上次同步后是否改动过；留 2 秒容差应对防抖保存。 */
export function isLocalDirty(metadata: SyncMetadataSnapshot, localUpdatedAt: number): boolean {
  if (!metadata) return true
  return localUpdatedAt > metadata.syncedAt + 2000
}

export function decideAutoSync(remoteVersion: number | null, metadata: SyncMetadataSnapshot, localUpdatedAt: number): AutoSyncDecision {
  const dirty = isLocalDirty(metadata, localUpdatedAt)
  // 云端还没有这份导图：本地有内容就上传（等于首次同步）。
  if (remoteVersion === null) return dirty ? 'push' : 'none'
  // 云端更新：本地干净才允许自动拉取；本地也改过则停住交给人。
  if (remoteVersion > (metadata?.remoteVersion ?? 0)) return dirty ? 'conflict' : 'pull'
  // 云端不新：本地有未上传修改就推上去。
  return dirty ? 'push' : 'none'
}
