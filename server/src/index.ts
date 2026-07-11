import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { config } from './config.js'
import { requireAllowedHost, requireAllowedOrigin, requireDevelopmentBearer, type AuthenticatedRequest } from './auth.js'
import { DocumentRepository } from './document-repository.js'
import { createMindTreeMcp } from './mcp.js'
import { mindMapDocumentSchema } from './mindmap-document.js'

const repository = new DocumentRepository(config.databasePath)
const app = express()
app.disable('x-powered-by')
app.use(requireAllowedHost)
app.use(requireAllowedOrigin)
app.use(express.json({ limit: '1mb' }))

app.get('/healthz', (_request, response) => response.json({ ok: true, service: 'mindtree-server', mcp: '/mcp' }))

// 配对凭据只存哈希、仅能兑换一次，并在五分钟后自动失效。
app.post('/api/v1/pairings', requireDevelopmentBearer, (request: AuthenticatedRequest, response) => {
  const challenge = repository.createPairingChallenge(request.ownerId!)
  return response.status(201).json({ pairingId: challenge.id, secret: challenge.secret, expiresAt: challenge.expiresAt })
})

app.post('/api/v1/pairings/:pairingId/exchange', (request, response) => {
  const secret = typeof request.body?.secret === 'string' ? request.body.secret : ''
  const pairingId = String(request.params.pairingId)
  if (!secret || !repository.claimPairingChallenge('local-user', pairingId, secret)) {
    return response.status(401).json({ error: { code: 'INVALID_PAIRING', message: '配对二维码无效、已使用或已过期' } })
  }
  return response.json({ token: config.devToken })
})

app.use('/api/v1', requireDevelopmentBearer)
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
  const saved = repository.save({ id: documentId, ownerId: request.ownerId!, title: payload.data.title, categoryId: payload.data.categoryId, payload: payload.data, baseVersion: body.baseVersion })
  return 'type' in saved ? response.status(409).json({ error: { code: saved.type }, document: saved.document }) : response.status(201).json(saved)
})

app.use('/mcp', requireDevelopmentBearer)
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

app.listen(config.port, config.host, () => {
  console.log(`MindTree server listening on http://${config.host}:${config.port}`)
})
