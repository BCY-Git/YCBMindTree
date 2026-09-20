/**
 * attachment-store — 附件字节的文件系统存储。
 *
 * 设计：导图 payload 里的附件元数据（id/name/type/size）是真相来源，
 * 这里只负责字节落盘。目录结构 data/attachments/<ownerId>/<documentId>/<attachmentId>，
 * 三层 id 都强制 UUID 形态，杜绝路径穿越。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const maxAttachmentBytes = 15 * 1024 * 1024
export const allowedAttachmentTypes = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'text/html',
])

export type AttachmentMeta = { id: string; name: string; type: string; size: number }

type PayloadWithNodes = { nodes?: Record<string, { attachments?: unknown }> }

/** 从导图快照里收集附件元数据；结构异常时返回空表（zod 已在上游把关）。 */
export function collectAttachmentMeta(payload: unknown): AttachmentMeta[] {
  const nodes = (payload as PayloadWithNodes | undefined)?.nodes
  if (!nodes || typeof nodes !== 'object') return []
  const metas: AttachmentMeta[] = []
  for (const node of Object.values(nodes)) {
    if (!Array.isArray(node?.attachments)) continue
    for (const value of node.attachments) {
      const meta = value as Partial<AttachmentMeta> | undefined
      if (meta && typeof meta.id === 'string' && typeof meta.name === 'string' && typeof meta.type === 'string' && typeof meta.size === 'number') {
        metas.push(meta as AttachmentMeta)
      }
    }
  }
  return metas
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isSafeAttachmentId(value: string): boolean {
  return uuidPattern.test(value)
}

export class AttachmentStore {
  readonly rootDir: string

  constructor(databasePath: string) {
    this.rootDir = join(dirname(databasePath), 'attachments')
  }

  private filePath(ownerId: string, documentId: string, attachmentId: string): string {
    for (const segment of [ownerId, documentId, attachmentId]) {
      // ownerId 可能是 'local-user' 这类非 UUID 值，只放行安全字符
      if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('附件路径包含非法字符')
    }
    return join(this.rootDir, ownerId, documentId, attachmentId)
  }

  save(ownerId: string, documentId: string, attachmentId: string, bytes: Buffer): { size: number; sha256: string } {
    if (bytes.byteLength > maxAttachmentBytes) throw new Error('附件超过 15 MB 上限')
    const filePath = this.filePath(ownerId, documentId, attachmentId)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, bytes)
    return { size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  }

  get(ownerId: string, documentId: string, attachmentId: string): Buffer | null {
    const filePath = this.filePath(ownerId, documentId, attachmentId)
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return null
    return readFileSync(filePath)
  }

  has(ownerId: string, documentId: string, attachmentId: string): boolean {
    return existsSync(this.filePath(ownerId, documentId, attachmentId))
  }

  /** 文档快照保存后清理不再被引用的附件字节。 */
  pruneDocument(ownerId: string, documentId: string, keepIds: Set<string>): number {
    const dir = join(this.rootDir, ownerId, documentId)
    if (!existsSync(dir)) return 0
    let removed = 0
    for (const entry of readdirSync(dir)) {
      if (!keepIds.has(entry)) {
        unlinkSync(join(dir, entry))
        removed += 1
      }
    }
    return removed
  }

  /** 删除整份文档的附件目录（文档删除时调用）。 */
  removeDocument(ownerId: string, documentId: string): void {
    rmSync(join(this.rootDir, ownerId, documentId), { recursive: true, force: true })
  }
}
