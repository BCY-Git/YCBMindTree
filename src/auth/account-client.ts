import { apiBaseUrl, type SyncConfig } from '@/sync/sync-client'
import { createApiClient } from '@/api/http-client'

export type Account = { id: string; email: string; createdAt: number }
export type AuthSession = { user: Account; token: string }

const storageKey = 'mindtree.account-session.v1'

export function loadAccountSession(): AuthSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<AuthSession> | null
    if (!value || !value.user || typeof value.token !== 'string' || typeof value.user.email !== 'string' || typeof value.user.id !== 'string') return null
    return value as AuthSession
  } catch { return null }
}

export function saveAccountSession(session: AuthSession) {
  localStorage.setItem(storageKey, JSON.stringify(session))
}

export function clearAccountSession() {
  localStorage.removeItem(storageKey)
}

async function authRequest(config: Pick<SyncConfig, 'serverUrl'>, action: 'login' | 'register', email: string, password: string): Promise<AuthSession> {
  const body = await createApiClient(config).post<{ user?: Account; token?: string }>(`/auth/${action}`, { email, password })
  if (!body?.user || typeof body.token !== 'string') throw new Error('登录请求失败')
  return { user: body.user, token: body.token }
}

export const loginAccount = (config: Pick<SyncConfig, 'serverUrl'>, email: string, password: string) => authRequest(config, 'login', email, password)
export const registerAccount = (config: Pick<SyncConfig, 'serverUrl'>, email: string, password: string) => authRequest(config, 'register', email, password)

export async function revokeAccountSession(config: Pick<SyncConfig, 'serverUrl'>, token: string) {
  await createApiClient({ serverUrl: config.serverUrl, token }).post('/auth/logout')
}
