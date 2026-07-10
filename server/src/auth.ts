import type { NextFunction, Request, Response } from 'express'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { config } from './config.js'

export type AuthenticatedRequest = Request & { auth?: AuthInfo; ownerId?: string }

export function requireDevelopmentBearer(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token || token !== config.devToken) return response.status(401).json({ error: { code: 'UNAUTHORIZED', message: '缺少或无效的 Bearer token' } })
  request.ownerId = 'local-user'
  request.auth = { token, clientId: request.ownerId, scopes: ['mindtree:read', 'mindtree:write'] }
  next()
}

export function requireAllowedHost(request: Request, response: Response, next: NextFunction) {
  const host = request.headers.host
  if (!host || !config.allowedHosts.includes(host)) return response.status(421).json({ error: { code: 'INVALID_HOST', message: 'Host 不在允许列表中' } })
  next()
}
