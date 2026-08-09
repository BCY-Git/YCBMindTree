import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'node:crypto'
import compression from 'compression'
import express from 'express'
import { requireAccountBearer, requireAllowedHost, requireAllowedOrigin, type AuthenticatedRequest } from './auth.js'
import { DocumentAccessError, DocumentRepository } from './document-repository.js'
import { createMindTreeMcp } from './mcp.js'
import { mindMapDocumentSchema } from './mindmap-document.js'

export type AppOptions = {
  devToken: string
  allowRegistration: boolean
  sessionLifetimeMs: number
  allowedHosts: readonly string[]
  allowedOrigins: readonly string[]
}

/** Creates the HTTP API without binding a port, so it can be tested or embedded safely. */
export function createApp(repository: DocumentRepository, options: AppOptions) {
  const app = express()
  app.disable('x-powered-by')
  app.use(compression())
  app.use(requireAllowedHost(options.allowedHosts))
  app.use(requireAllowedOrigin(options.allowedOrigins))
  app.use(express.json({ limit: '1mb' }))

  app.get('/healthz', (_request, response) => response.json({ ok: true, service: 'mindtree-server', mcp: '/mcp' }))

  const recentClientDiagnostics = new Map<string, number>()
  app.post('/api/v1/client-diagnostics', (request, response) => {
    const source = request.ip || request.socket.remoteAddress || 'unknown'
    const now = Date.now()
    if (now - (recentClientDiagnostics.get(source) ?? 0) < 10_000) return response.status(204).end()
    recentClientDiagnostics.set(source, now)
    const kind = typeof request.body?.kind === 'string' ? request.body.kind.slice(0, 80) : 'unknown'
    const message = typeof request.body?.message === 'string' ? request.body.message.slice(0, 500) : ''
    const asset = typeof request.body?.asset === 'string' ? request.body.asset.slice(0, 300) : ''
    console.warn(`[client-diagnostic] kind=${JSON.stringify(kind)} message=${JSON.stringify(message)} asset=${JSON.stringify(asset)}`)
    return response.status(204).end()
  })

  const requireApiBearer = requireAccountBearer(repository, options.devToken)
  app.post('/api/v1/auth/register', (request, response) => {
  if (!options.allowRegistration) return response.status(403).json({ error: { code: 'REGISTRATION_DISABLED', message: '服务器暂未开放注册，请联系管理员。' } })
  const email = typeof request.body?.email === 'string' ? request.body.email : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  try {
    const user = repository.registerAccount(email, password)
    if (!user) return response.status(409).json({ error: { code: 'EMAIL_EXISTS', message: '该邮箱已注册，请直接登录。' } })
    return response.status(201).json({ user, token: repository.createSession(user.id, options.sessionLifetimeMs) })
  } catch {
    return response.status(400).json({ error: { code: 'INVALID_ACCOUNT', message: '请输入有效邮箱，且密码至少 8 位。' } })
  }
})
app.post('/api/v1/auth/login', (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  const user = repository.authenticateAccount(email, password)
  if (!user) return response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误。' } })
  return response.json({ user, token: repository.createSession(user.id, options.sessionLifetimeMs) })
})
app.post('/api/v1/auth/logout', requireApiBearer, (request: AuthenticatedRequest, response) => {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (token && token !== options.devToken) repository.revokeSession(token)
  return response.status(204).end()
})

// 配对凭据只存哈希、仅能兑换一次，并在五分钟后自动失效。
app.post('/api/v1/pairings', requireApiBearer, (request: AuthenticatedRequest, response) => {
  const challenge = repository.createPairingChallenge(request.ownerId!)
  return response.status(201).json({ pairingId: challenge.id, secret: challenge.secret, expiresAt: challenge.expiresAt })
})

app.post('/api/v1/pairings/:pairingId/exchange', (request, response) => {
  const secret = typeof request.body?.secret === 'string' ? request.body.secret : ''
  const pairingId = String(request.params.pairingId)
  const ownerId = secret ? repository.claimPairingChallenge(pairingId, secret) : null
  if (!ownerId) {
    return response.status(401).json({ error: { code: 'INVALID_PAIRING', message: '配对二维码无效、已使用或已过期' } })
  }
  return response.json({ token: repository.createSession(ownerId, options.sessionLifetimeMs) })
})

app.use('/api/v1', requireApiBearer)
app.get('/api/v1/documents', (request: AuthenticatedRequest, response) => response.json({ documents: repository.list(request.ownerId!) }))
app.get('/api/v1/documents/:documentId', (request: AuthenticatedRequest, response) => {
  const document = repository.get(request.ownerId!, String(request.params.documentId))
  return document ? response.json(document) : response.status(404).json({ error: { code: 'NOT_FOUND', message: '导图不存在' } })
})
app.put('/api/v1/documents/:documentId', (request: AuthenticatedRequest, response) => {
  const body = request.body as { payload?: unknown; baseVersion?: unknown }
  const payload = mindMapDocumentSchema.safeParse(body.payload)
  const documentId = String(request.params.documentId)
  if (typeof body.baseVersion !== 'number' || !payload.success || payload.data.id !== documentId) {
    return response.status(400).json({ error: { code: 'INVALID_DOCUMENT', message: '导图快照、路径 ID 或 baseVersion 无效' } })
  }
  try {
    const saved = repository.save({ id: documentId, ownerId: request.ownerId!, title: payload.data.title, categoryId: payload.data.categoryId, payload: payload.data, baseVersion: body.baseVersion })
    return 'type' in saved ? response.status(409).json({ error: { code: saved.type }, document: saved.document }) : response.status(201).json(saved)
  } catch (error) {
    if (error instanceof DocumentAccessError) return response.status(404).json({ error: { code: 'NOT_FOUND', message: '导图不存在' } })
    throw error
  }
})

  app.use('/mcp', requireApiBearer)
  const mcpSessions = new Map<string, { transport: StreamableHTTPServerTransport; close: () => Promise<void> }>()

  async function createMcpSession() {
  const mcp = createMindTreeMcp(repository)
  let transport!: StreamableHTTPServerTransport
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => { mcpSessions.set(sessionId, { transport, close: () => mcp.close() }) },
    onsessionclosed: async (sessionId) => {
      const session = mcpSessions.get(sessionId)
      mcpSessions.delete(sessionId)
      await session?.close()
    },
  })
  await mcp.connect(transport)
  return transport
  }

  app.all('/mcp', async (request: AuthenticatedRequest, response) => {
  try {
    const sessionId = request.header('mcp-session-id')
    const session = sessionId ? mcpSessions.get(sessionId) : undefined
    if (sessionId && !session) return response.status(404).json({ error: { code: 'MCP_SESSION_NOT_FOUND', message: 'MCP 会话不存在或已过期' } })
    const transport = session?.transport ?? await createMcpSession()
    await transport.handleRequest(request as never, response, request.body)
  } catch (error) {
    console.error('MCP request failed', error)
    if (!response.headersSent) response.status(500).json({ error: { code: 'MCP_REQUEST_FAILED', message: error instanceof Error ? error.message : 'MCP 请求失败' } })
  }
  })

  return app
}
