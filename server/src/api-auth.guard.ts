import 'reflect-metadata'
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { Request } from 'express'
import { apiError } from './api-error.js'
import { MINDTREE_RUNTIME, type MindTreeRuntime } from './runtime.js'

export type AuthenticatedRequest = Request & { auth?: AuthInfo; ownerId?: string }

/** 兼容既有开发 Token，同时接受数据库保存的账号会话 Token。 */
@Injectable()
export class ApiBearerGuard implements CanActivate {
  constructor(@Inject(MINDTREE_RUNTIME) private readonly runtime: MindTreeRuntime) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = request.header('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) throw apiError(401, 'UNAUTHORIZED', '缺少 Bearer token')

    const ownerId = token === this.runtime.options.devToken ? 'local-user' : this.runtime.repository.sessionOwner(token)
    if (!ownerId) throw apiError(401, 'UNAUTHORIZED', 'Bearer token 无效或已过期')

    request.ownerId = ownerId
    request.auth = { token, clientId: ownerId, scopes: ['mindtree:read', 'mindtree:write'] }
    return true
  }
}
