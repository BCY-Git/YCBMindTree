import Database from 'better-sqlite3'
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type DocumentRecord = {
  id: string
  ownerId: string
  title: string
  categoryId: string
  version: number
  payload: unknown
  createdAt: number
  updatedAt: number
}

export type VersionConflict = { type: 'VERSION_CONFLICT'; document: DocumentRecord }

export class DocumentAccessError extends Error {
  constructor() {
    super('导图不存在或无权访问')
    this.name = 'DocumentAccessError'
  }
}

export type PairingChallenge = {
  id: string
  secret: string
  expiresAt: number
}

export type AccountUser = { id: string; email: string; createdAt: number }

/** 每张导图只保留最近的变更快照，避免长期同步导致 SQLite 无限增长。 */
export const DOCUMENT_CHANGE_RETENTION = 200

export class DocumentRepository {
  private readonly database: Database.Database

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.database = new Database(databasePath)
    this.database.pragma('journal_mode = WAL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        category_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS documents_owner_updated ON documents(owner_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS pairing_challenges (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        claimed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS pairing_challenges_expiry ON pairing_challenges(expires_at);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS document_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
  }

  list(ownerId: string): DocumentRecord[] {
    const rows = this.database.prepare('SELECT * FROM documents WHERE owner_id = ? ORDER BY updated_at DESC').all(ownerId) as Array<Record<string, unknown>>
    return rows.map((row) => this.fromRow(row))
  }

  get(ownerId: string, documentId: string): DocumentRecord | undefined {
    const row = this.database.prepare('SELECT * FROM documents WHERE id = ? AND owner_id = ?').get(documentId, ownerId) as Record<string, unknown> | undefined
    return row ? this.fromRow(row) : undefined
  }

  save(input: Omit<DocumentRecord, 'version' | 'createdAt' | 'updatedAt'> & { baseVersion: number; kind?: string }): DocumentRecord | VersionConflict {
    const existing = this.getById(input.id)
    if (existing && existing.ownerId !== input.ownerId) throw new DocumentAccessError()
    const current = existing
    if (current && current.version !== input.baseVersion) return { type: 'VERSION_CONFLICT', document: current }
    if (!current && input.baseVersion !== 0) throw new Error('新文档的 baseVersion 必须为 0')

    const now = Date.now()
    const next: DocumentRecord = {
      id: input.id,
      ownerId: input.ownerId,
      title: input.title,
      categoryId: input.categoryId,
      version: (current?.version ?? 0) + 1,
      payload: input.payload,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    }
    const transaction = this.database.transaction(() => {
      this.database.prepare(`INSERT INTO documents (id, owner_id, title, category_id, version, payload_json, created_at, updated_at)
        VALUES (@id, @ownerId, @title, @categoryId, @version, @payloadJson, @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, category_id = excluded.category_id, version = excluded.version,
        payload_json = excluded.payload_json, updated_at = excluded.updated_at`).run({ ...next, payloadJson: JSON.stringify(next.payload) })
      this.database.prepare('INSERT INTO document_changes (document_id, version, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(next.id, next.version, input.kind ?? 'snapshot', JSON.stringify(next.payload), now)
      this.database.prepare(`DELETE FROM document_changes
        WHERE document_id = ? AND id NOT IN (
          SELECT id FROM document_changes WHERE document_id = ? ORDER BY id DESC LIMIT ?
        )`).run(next.id, next.id, DOCUMENT_CHANGE_RETENTION)
    })
    transaction()
    return next
  }

  searchNodes(ownerId: string, query: string): Array<{ documentId: string; documentTitle: string; nodeId: string; topic: string }> {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return []
    return this.list(ownerId).flatMap((document) => {
      const nodes = (document.payload as { nodes?: Record<string, { topic?: unknown }> }).nodes ?? {}
      return Object.entries(nodes).flatMap(([nodeId, node]) => typeof node.topic === 'string' && node.topic.toLocaleLowerCase().includes(needle)
        ? [{ documentId: document.id, documentTitle: document.title, nodeId, topic: node.topic }]
        : [])
    })
  }

  createPairingChallenge(ownerId: string, lifetimeMs = 5 * 60 * 1000): PairingChallenge {
    const id = randomUUID()
    const secret = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + lifetimeMs
    this.database.prepare('DELETE FROM pairing_challenges WHERE expires_at < ? OR claimed_at IS NOT NULL').run(Date.now())
    this.database.prepare('INSERT INTO pairing_challenges (id, owner_id, secret_hash, expires_at, claimed_at) VALUES (?, ?, ?, ?, NULL)')
      .run(id, ownerId, hashPairingSecret(secret), expiresAt)
    return { id, secret, expiresAt }
  }

  /**
   * 领取一次性配对码，并返回原设备所属账号。ownerId 仅由服务端存储的 challenge
   * 决定，扫码端不能把自己配到任意指定账号。
   */
  claimPairingChallenge(id: string, secret: string): string | null {
    const now = Date.now()
    const challenge = this.database.prepare(`SELECT owner_id FROM pairing_challenges
      WHERE id = ? AND secret_hash = ? AND expires_at > ? AND claimed_at IS NULL`)
      .get(id, hashPairingSecret(secret), now) as { owner_id?: unknown } | undefined
    if (!challenge?.owner_id) return null
    const result = this.database.prepare(`UPDATE pairing_challenges
      SET claimed_at = ?
      WHERE id = ? AND secret_hash = ? AND expires_at > ? AND claimed_at IS NULL`)
      .run(now, id, hashPairingSecret(secret), now)
    return result.changes === 1 ? String(challenge.owner_id) : null
  }

  registerAccount(email: string, password: string): AccountUser | null {
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail || password.length < 8) throw new Error('邮箱或密码格式无效')
    const exists = this.database.prepare('SELECT 1 FROM users WHERE email = ?').get(normalizedEmail)
    if (exists) return null
    const firstAccount = Number((this.database.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count) === 0
    const user: AccountUser = { id: firstAccount ? 'local-user' : randomUUID(), email: normalizedEmail, createdAt: Date.now() }
    this.database.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(user.id, user.email, passwordHash(password), user.createdAt)
    return user
  }

  authenticateAccount(email: string, password: string): AccountUser | null {
    const row = this.database.prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ?').get(normalizeEmail(email)) as Record<string, unknown> | undefined
    if (!row || !verifyPassword(password, String(row.password_hash))) return null
    return { id: String(row.id), email: String(row.email), createdAt: Number(row.created_at) }
  }

  createSession(userId: string, lifetimeMs: number): string {
    const token = randomBytes(32).toString('base64url')
    const now = Date.now()
    this.database.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now)
    this.database.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), userId, now + lifetimeMs, now)
    return token
  }

  sessionOwner(token: string): string | null {
    const row = this.database.prepare('SELECT user_id FROM auth_sessions WHERE token_hash = ? AND expires_at > ?').get(hashToken(token), Date.now()) as { user_id?: unknown } | undefined
    return row?.user_id ? String(row.user_id) : null
  }

  revokeSession(token: string) {
    this.database.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token))
  }

  changeCount(documentId: string): number {
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM document_changes WHERE document_id = ?').get(documentId) as { count: number }
    return Number(row.count)
  }

  private fromRow(row: Record<string, unknown>): DocumentRecord {
    return {
      id: String(row.id), ownerId: String(row.owner_id), title: String(row.title), categoryId: String(row.category_id), version: Number(row.version),
      payload: JSON.parse(String(row.payload_json)), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }
  }

  private getById(documentId: string): DocumentRecord | undefined {
    const row = this.database.prepare('SELECT * FROM documents WHERE id = ?').get(documentId) as Record<string, unknown> | undefined
    return row ? this.fromRow(row) : undefined
  }
}

function hashPairingSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function normalizeEmail(email: string) {
  const value = email.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : ''
}

function passwordHash(password: string) {
  const salt = randomBytes(16).toString('base64url')
  const derived = scryptSync(password, salt, 64).toString('base64url')
  return `${salt}.${derived}`
}

function verifyPassword(password: string, encoded: string) {
  const [salt, stored] = encoded.split('.')
  if (!salt || !stored) return false
  const candidate = scryptSync(password, salt, 64).toString('base64url')
  const left = Buffer.from(candidate)
  const right = Buffer.from(stored)
  return left.length === right.length && timingSafeEqual(left, right)
}
