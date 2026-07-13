import type { NextFunction, Request, Response } from 'express'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { DocumentRepository } from './document-repository.js'

export type AuthenticatedRequest = Request & { auth?: AuthInfo; ownerId?: string }

export function requireDevelopmentBearer(devToken: string) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const token = request.header('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token || token !== devToken) return response.status(401).json({ error: { code: 'UNAUTHORIZED', message: '缺少或无效的 Bearer token' } })
    request.ownerId = 'local-user'
    request.auth = { token, clientId: request.ownerId, scopes: ['mindtree:read', 'mindtree:write'] }
    next()
  }
}

/** 兼容既有开发 Token，同时接受数据库保存的账号会话 Token。 */
export function requireAccountBearer(repository: DocumentRepository, devToken: string) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const token = request.header('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return response.status(401).json({ error: { code: 'UNAUTHORIZED', message: '缺少 Bearer token' } })
    const ownerId = token === devToken ? 'local-user' : repository.sessionOwner(token)
    if (!ownerId) return response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bearer token 无效或已过期' } })
    request.ownerId = ownerId
    request.auth = { token, clientId: ownerId, scopes: ['mindtree:read', 'mindtree:write'] }
    next()
  }
}

export function requireAllowedHost(allowedHosts: readonly string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const host = request.headers.host
    if (!host || !allowedHosts.includes(host)) return response.status(421).json({ error: { code: 'INVALID_HOST', message: 'Host 不在允许列表中' } })
    next()
  }
}

/** 仅允许配置过的 Web 来源携带 Bearer Token 调用同步 API。 */
export function requireAllowedOrigin(allowedOrigins: readonly string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.header('origin')
    if (origin && allowedOrigins.includes(origin)) {
      response.setHeader('access-control-allow-origin', origin)
      response.setHeader('vary', 'Origin')
      response.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS')
      response.setHeader('access-control-allow-headers', 'Authorization, Content-Type')
    }
    if (request.method === 'OPTIONS') return response.status(204).end()
    next()
  }
}
