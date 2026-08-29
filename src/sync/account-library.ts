import type { MindMapDocument } from '@/domain/document.types'
import type { SyncMetadata } from '@/persistence/database'
import type { PushResult, RemoteDocument, SyncConfig } from '@/sync/sync-client'

export type AccountLibrarySyncDependencies = {
  listLocalDocuments: () => Promise<MindMapDocument[]>
  listRemoteDocuments: (config: SyncConfig) => Promise<RemoteDocument[]>
  loadMetadata: (documentId: string) => Promise<SyncMetadata | undefined>
  saveLocalDocument: (document: MindMapDocument) => Promise<void>
  saveMetadata: (metadata: SyncMetadata) => Promise<void>
  pushLocalDocument: (config: SyncConfig, document: MindMapDocument, baseVersion: number) => Promise<PushResult>
}

export type AccountLibrarySyncResult = {
  documents: MindMapDocument[]
  preferredDocument: MindMapDocument | null
  imported: number
  uploaded: number
  updated: number
  conflicts: number
  /** 因属于其他账号或归属不明而跳过上传的本地文档数。 */
  protected: number
}

export function isUntouchedStarterDocument(document: MindMapDocument): boolean {
  const topics = Object.values(document.nodes).map((node) => node.topic).sort()
  return document.title === '未命名导图'
    && document.createdAt === document.updatedAt
    && topics.length === 4
    && ['从这里开始', '我的思维导图', '按 Enter 创建同级节点', '按 Tab 创建子节点'].every((topic) => topics.includes(topic))
}

function documentsMatch(left: MindMapDocument, right: MindMapDocument): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * 登录后的账号级导图库同步。
 *
 * - 云端独有：安全导入本地；
 * - 本地独有：首次上传到账号；
 * - 两端都存在：只有本地明确处于上次同步后的干净状态时才自动拉取；
 * - 无法确认基线或两端都改过：保留本地并报告冲突，不自动覆盖。
 */
export async function synchronizeAccountLibrary(config: SyncConfig, dependencies: AccountLibrarySyncDependencies, accountId: string): Promise<AccountLibrarySyncResult> {
  const [localDocuments, remoteDocuments] = await Promise.all([
    dependencies.listLocalDocuments(),
    dependencies.listRemoteDocuments(config),
  ])
  const localById = new Map(localDocuments.map((document) => [document.id, document]))
  const remoteById = new Map(remoteDocuments.map((document) => [document.id, document]))
  const activeStarter = localDocuments.length === 1 && isUntouchedStarterDocument(localDocuments[0])
  let imported = 0
  let uploaded = 0
  let updated = 0
  let conflicts = 0
  let protectedDocuments = 0

  for (const remote of remoteDocuments) {
    const local = localById.get(remote.id)
    if (!local) {
      await dependencies.saveLocalDocument(remote.payload)
      await dependencies.saveMetadata({ documentId: remote.id, remoteVersion: remote.version, syncedAt: Date.now(), accountId })
      imported += 1
      continue
    }

    const metadata = await dependencies.loadMetadata(remote.id)
    if (metadata?.accountId && metadata.accountId !== accountId) {
      conflicts += 1
      continue
    }
    if (!metadata) {
      if (documentsMatch(local, remote.payload)) {
        await dependencies.saveMetadata({ documentId: remote.id, remoteVersion: remote.version, syncedAt: Date.now(), accountId })
      } else {
        conflicts += 1
      }
      continue
    }
    // 旧版元数据没有账号归属：只有内容完全一致时才认领，避免账号切换时误覆盖。
    if (!metadata.accountId) {
      if (documentsMatch(local, remote.payload)) {
        await dependencies.saveMetadata({ documentId: remote.id, remoteVersion: remote.version, syncedAt: Date.now(), accountId })
      } else {
        conflicts += 1
      }
      continue
    }
    if (remote.version <= metadata.remoteVersion) continue

    const localDirty = local.updatedAt > metadata.syncedAt + 2_000
    if (localDirty) {
      conflicts += 1
      continue
    }
    await dependencies.saveLocalDocument(remote.payload)
    await dependencies.saveMetadata({ documentId: remote.id, remoteVersion: remote.version, syncedAt: Date.now(), accountId })
    updated += 1
  }

  for (const local of localDocuments) {
    if (local.isDraft || remoteById.has(local.id)) continue
    // 新网页端自带的教学导图不是用户数据；账号已有云端内容时不把它上传成一份多余导图。
    if (activeStarter && remoteDocuments.length > 0 && isUntouchedStarterDocument(local)) continue
    const metadata = await dependencies.loadMetadata(local.id)
    if (metadata && metadata.accountId !== accountId) {
      protectedDocuments += 1
      continue
    }
    const result = await dependencies.pushLocalDocument(config, local, 0)
    if (result.type === 'conflict') {
      conflicts += 1
      continue
    }
    await dependencies.saveMetadata({ documentId: local.id, remoteVersion: result.remote.version, syncedAt: Date.now(), accountId })
    uploaded += 1
  }

  return {
    documents: await dependencies.listLocalDocuments(),
    preferredDocument: activeStarter && remoteDocuments.length > 0 ? remoteDocuments[0].payload : null,
    imported,
    uploaded,
    updated,
    conflicts,
    protected: protectedDocuments,
  }
}
