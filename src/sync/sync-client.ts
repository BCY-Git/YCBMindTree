import { mindMapDocumentSchema } from '../domain/document.schema'
import { assertValidDocument } from '../domain/document.validator'
import type { MindMapDocument } from '../domain/document.types'
import { platformFetch } from '../platform/tauri'

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

export function apiBaseUrl(serverUrl: string): string {
  const base = serverUrl.trim().replace(/\/+$/, '')
  if (!base) throw new Error('请填写同步服务地址')
  return base.endsWith('/api/v1') ? base : `${base}/api/v1`
}

async function request(config: SyncConfig, path: string, init: RequestInit): Promise<Response> {
  if (!config.token.trim()) throw new Error('请填写同步 Token')
  return platformFetch(`${apiBaseUrl(config.serverUrl)}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${config.token.trim()}`, 'content-type': 'application/json', ...init.headers },
  })
}

async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
  return new Error(body?.error?.message ?? `同步请求失败（HTTP ${response.status}）`)
}

export async function fetchRemoteDocument(config: SyncConfig, documentId: string): Promise<RemoteDocument | null> {
  const response = await request(config, `/documents/${encodeURIComponent(documentId)}`, { method: 'GET' })
  if (response.status === 404) return null
  if (!response.ok) throw await responseError(response)
  return parseRemoteRecord(await response.json())
}

export async function fetchRemoteDocuments(config: SyncConfig): Promise<RemoteDocument[]> {
  const response = await request(config, '/documents', { method: 'GET' })
  const body = await response.json().catch(() => null) as { documents?: unknown } | null
  if (!response.ok) throw await responseError(response)
  if (!body || !Array.isArray(body.documents)) throw new Error('服务端返回的导图库格式无效')
  return body.documents.map(parseRemoteRecord)
}

export async function pushDocument(config: SyncConfig, document: MindMapDocument, baseVersion: number): Promise<PushResult> {
  const response = await request(config, `/documents/${encodeURIComponent(document.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ title: document.title, categoryId: document.categoryId, payload: document, baseVersion }),
  })
  const body = await response.json().catch(() => null) as { document?: unknown } | RemoteRecord | null
  if (response.status === 409 && body && 'document' in body) return { type: 'conflict', remote: parseRemoteRecord(body.document) }
  if (!response.ok || !body) throw await responseError(response)
  return { type: 'saved', remote: parseRemoteRecord(body) }
}

export async function createPairingInvite(config: SyncConfig): Promise<PairingInvite> {
  const response = await request(config, '/pairings', { method: 'POST', body: '{}' })
  const body = await response.json().catch(() => null) as { pairingId?: unknown; secret?: unknown; expiresAt?: unknown } | null
  if (!response.ok || !body || typeof body.pairingId !== 'string' || typeof body.secret !== 'string' || typeof body.expiresAt !== 'number') {
    throw !response.ok ? await responseError(response) : new Error('服务端返回的配对凭据无效')
  }
  return { type: 'mindtree-pairing-v1', serverUrl: config.serverUrl.trim(), pairingId: body.pairingId, secret: body.secret, expiresAt: body.expiresAt }
}

export async function redeemPairingInvite(invite: PairingInvite): Promise<string> {
  const response = await platformFetch(`${apiBaseUrl(invite.serverUrl)}/pairings/${encodeURIComponent(invite.pairingId)}/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: invite.secret }),
  })
  const body = await response.json().catch(() => null) as { token?: unknown } | null
  if (!response.ok || !body || typeof body.token !== 'string' || !body.token.trim()) {
    throw !response.ok ? await responseError(response) : new Error('服务端未返回同步 Token')
  }
  return body.token
}
