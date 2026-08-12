import { mindMapDocumentSchema } from '@/domain/document.schema'
import { assertValidDocument } from '@/domain/document.validator'
import type { MindMapDocument } from '@/domain/document.types'
import { ApiHttpError, apiBaseUrl, createApiClient } from '@/api/http-client'

const configStorageKey = 'mindtree.sync-config.v1'

// MindTree 当前的受控同步服务。用户仍可在同步设置中覆盖为自己的地址。
export const defaultSyncServerUrl = 'http://106.54.44.45:18789'

export type SyncConfig = {
  serverUrl: string
  token: string
}

export type RemoteDocument = {
  id: string
  version: number
  payload: MindMapDocument
  updatedAt: number
}

export type PairingInvite = {
  type: 'mindtree-pairing-v1'
  serverUrl: string
  pairingId: string
  secret: string
  expiresAt: number
}

export type PushResult =
  | { type: 'saved'; remote: RemoteDocument }
  | { type: 'conflict'; remote: RemoteDocument }

type RemoteRecord = {
  id: string
  version: number
  payload: unknown
  updatedAt: number
}

function parseRemoteRecord(value: unknown): RemoteDocument {
  const record = value as RemoteRecord
  if (!record || typeof record.id !== 'string' || typeof record.version !== 'number' || typeof record.updatedAt !== 'number') {
    throw new Error('服务端返回的导图记录格式无效')
  }
  const payload = mindMapDocumentSchema.parse(record.payload)
  assertValidDocument(payload)
  return { id: record.id, version: record.version, payload, updatedAt: record.updatedAt }
}

export function loadSyncConfig(): SyncConfig {
  try {
    const value = JSON.parse(localStorage.getItem(configStorageKey) ?? '{}') as Partial<SyncConfig>
    const savedServerUrl = typeof value.serverUrl === 'string' ? value.serverUrl.trim() : ''
    return { serverUrl: savedServerUrl || defaultSyncServerUrl, token: typeof value.token === 'string' ? value.token : '' }
  } catch {
    return { serverUrl: defaultSyncServerUrl, token: '' }
  }
}

export function saveSyncConfig(config: SyncConfig): void {
  localStorage.setItem(configStorageKey, JSON.stringify(config))
}

export { apiBaseUrl } from '@/api/http-client'

function request(config: SyncConfig) {
  if (!config.token.trim()) throw new Error('请填写同步 Token')
  return createApiClient(config)
}

export async function fetchRemoteDocument(config: SyncConfig, documentId: string): Promise<RemoteDocument | null> {
  try {
    return parseRemoteRecord(await request(config).get(`/documents/${encodeURIComponent(documentId)}`))
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 404) return null
    throw error
  }
}

export async function fetchRemoteDocuments(config: SyncConfig): Promise<RemoteDocument[]> {
  const body = await request(config).get<{ documents?: unknown }>('/documents')
  if (!body || !Array.isArray(body.documents)) throw new Error('服务端返回的导图库格式无效')
  return body.documents.map(parseRemoteRecord)
}

export async function pushDocument(config: SyncConfig, document: MindMapDocument, baseVersion: number): Promise<PushResult> {
  try {
    const body = await request(config).put<RemoteRecord>(`/documents/${encodeURIComponent(document.id)}`, { title: document.title, categoryId: document.categoryId, payload: document, baseVersion })
    return { type: 'saved', remote: parseRemoteRecord(body) }
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 409 && error.body && typeof error.body === 'object' && 'document' in error.body) {
      return { type: 'conflict', remote: parseRemoteRecord((error.body as { document: unknown }).document) }
    }
    throw error
  }
}

export async function createPairingInvite(config: SyncConfig): Promise<PairingInvite> {
  const body = await request(config).post<{ pairingId?: unknown; secret?: unknown; expiresAt?: unknown }>('/pairings', {})
  if (!body || typeof body.pairingId !== 'string' || typeof body.secret !== 'string' || typeof body.expiresAt !== 'number') throw new Error('服务端返回的配对凭据无效')
  return { type: 'mindtree-pairing-v1', serverUrl: config.serverUrl.trim(), pairingId: body.pairingId, secret: body.secret, expiresAt: body.expiresAt }
}

export async function redeemPairingInvite(invite: PairingInvite): Promise<string> {
  const body = await createApiClient({ serverUrl: invite.serverUrl }).post<{ token?: unknown }>(`/pairings/${encodeURIComponent(invite.pairingId)}/exchange`, { secret: invite.secret })
  if (!body || typeof body.token !== 'string' || !body.token.trim()) throw new Error('服务端未返回同步 Token')
  return body.token
}
