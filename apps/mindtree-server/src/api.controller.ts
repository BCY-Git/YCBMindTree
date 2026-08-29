import 'reflect-metadata'
import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { apiError } from './api-error.js'
import { ApiBearerGuard, type AuthenticatedRequest } from './api-auth.guard.js'
import { DocumentAccessError } from './document-repository.js'
import { mindMapDocumentSchema } from './mindmap-document.js'
import { MINDTREE_RUNTIME, type MindTreeRuntime } from './runtime.js'

@Controller()
export class HealthController {
  @Get('healthz')
  health() {
    return { ok: true, service: 'mindtree-server', mcp: '/mcp' }
  }
}

@Controller('api/v1/client-diagnostics')
export class ClientDiagnosticsController {
  private readonly recentSources = new Map<string, number>()

  @Post()
  @HttpCode(204)
  report(@Req() request: Request, @Body() body: unknown): void {
    const source = request.ip || request.socket.remoteAddress || 'unknown'
    const now = Date.now()
    if (now - (this.recentSources.get(source) ?? 0) < 10_000) return
    this.recentSources.set(source, now)

    const value = body as Record<string, unknown> | undefined
    const kind = typeof value?.kind === 'string' ? value.kind.slice(0, 80) : 'unknown'
    const message = typeof value?.message === 'string' ? value.message.slice(0, 500) : ''
    const asset = typeof value?.asset === 'string' ? value.asset.slice(0, 300) : ''
    console.warn(`[client-diagnostic] kind=${JSON.stringify(kind)} message=${JSON.stringify(message)} asset=${JSON.stringify(asset)}`)
  }
}

@Controller('api/v1/auth')
export class AuthController {
  constructor(@Inject(MINDTREE_RUNTIME) private readonly runtime: MindTreeRuntime) {}

  @Post('register')
  register(@Body() body: unknown) {
    if (!this.runtime.options.allowRegistration) throw apiError(403, 'REGISTRATION_DISABLED', '服务器暂未开放注册，请联系管理员。')
    const { email, password } = accountCredentials(body)
    try {
      const user = this.runtime.repository.registerAccount(email, password)
      if (!user) throw apiError(409, 'EMAIL_EXISTS', '该邮箱已注册，请直接登录。')
      return { user, token: this.runtime.repository.createSession(user.id, this.runtime.options.sessionLifetimeMs) }
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error
      throw apiError(400, 'INVALID_ACCOUNT', '请输入有效邮箱，且密码至少 8 位。')
    }
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const { email, password } = accountCredentials(body)
    const user = this.runtime.repository.authenticateAccount(email, password)
    if (!user) throw apiError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误。')
    return { user, token: this.runtime.repository.createSession(user.id, this.runtime.options.sessionLifetimeMs) }
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(ApiBearerGuard)
  logout(@Req() request: AuthenticatedRequest): void {
    const token = request.header('authorization')?.replace(/^Bearer\s+/i, '')
    if (token && token !== this.runtime.options.devToken) this.runtime.repository.revokeSession(token)
  }
}

@Controller('api/v1/pairings')
export class PairingsController {
  constructor(@Inject(MINDTREE_RUNTIME) private readonly runtime: MindTreeRuntime) {}

  @Post()
  @UseGuards(ApiBearerGuard)
  create(@Req() request: AuthenticatedRequest) {
    const challenge = this.runtime.repository.createPairingChallenge(request.ownerId!)
    return { pairingId: challenge.id, secret: challenge.secret, expiresAt: challenge.expiresAt }
  }

  @Post(':pairingId/exchange')
  @HttpCode(200)
  exchange(@Param('pairingId') pairingId: string, @Body() body: unknown) {
    const value = body as Record<string, unknown> | undefined
    const secret = typeof value?.secret === 'string' ? value.secret : ''
    const ownerId = secret ? this.runtime.repository.claimPairingChallenge(pairingId, secret) : null
    if (!ownerId) throw apiError(401, 'INVALID_PAIRING', '配对二维码无效、已使用或已过期')
    return { token: this.runtime.repository.createSession(ownerId, this.runtime.options.sessionLifetimeMs) }
  }
}

@Controller('api/v1/documents')
@UseGuards(ApiBearerGuard)
export class DocumentsController {
  constructor(@Inject(MINDTREE_RUNTIME) private readonly runtime: MindTreeRuntime) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return { documents: this.runtime.repository.list(request.ownerId!) }
  }

  @Get(':documentId')
  get(@Req() request: AuthenticatedRequest, @Param('documentId') documentId: string) {
    const document = this.runtime.repository.get(request.ownerId!, documentId)
    if (!document) throw apiError(404, 'NOT_FOUND', '导图不存在')
    return document
  }

  @Put(':documentId')
  @HttpCode(201)
  save(@Req() request: AuthenticatedRequest, @Param('documentId') documentId: string, @Body() body: unknown) {
    const value = body as { payload?: unknown; baseVersion?: unknown }
    const payload = mindMapDocumentSchema.safeParse(value?.payload)
    if (typeof value?.baseVersion !== 'number' || !payload.success || payload.data.id !== documentId) {
      throw apiError(400, 'INVALID_DOCUMENT', '导图快照、路径 ID 或 baseVersion 无效')
    }
    try {
      const saved = this.runtime.repository.save({
        id: documentId,
        ownerId: request.ownerId!,
        title: payload.data.title,
        categoryId: payload.data.categoryId,
        payload: payload.data,
        baseVersion: value.baseVersion,
      })
      if ('type' in saved) throw new HttpException({ error: { code: saved.type }, document: saved.document }, 409)
      return saved
    } catch (error) {
      if (error instanceof DocumentAccessError) throw apiError(404, 'NOT_FOUND', '导图不存在')
      throw error
    }
  }
}

function accountCredentials(body: unknown) {
  const value = body as Record<string, unknown> | undefined
  return {
    email: typeof value?.email === 'string' ? value.email : '',
    password: typeof value?.password === 'string' ? value.password : '',
  }
}
