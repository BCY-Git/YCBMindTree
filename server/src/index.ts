import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { config } from './config.js'
import { requireAllowedHost, requireDevelopmentBearer, type AuthenticatedRequest } from './auth.js'
import { DocumentRepository } from './document-repository.js'
import { createMindTreeMcp } from './mcp.js'

const repository = new DocumentRepository(config.databasePath)
const app = express()
app.disable('x-powered-by')
app.use(requireAllowedHost)
app.use(express.json({ limit: '1mb' }))

app.get('/healthz', (_request, response) => response.json({ ok: true, service: 'mindtree-server', mcp: '/mcp' }))

app.use('/api/v1', requireDevelopmentBearer)
app.get('/api/v1/documents', (request: AuthenticatedRequest, response) => response.json({ documents: repository.list(request.ownerId!) }))
app.get('/api/v1/documents/:documentId', (request: AuthenticatedRequest, response) => {
  const document = repository.get(request.ownerId!, String(request.params.documentId))
  return document ? response.json(document) : response.status(404).json({ error: { code: 'NOT_FOUND', message: '导图不存在' } })
})
app.put('/api/v1/documents/:documentId', (request: AuthenticatedRequest, response) => {
  const body = request.body as { title?: unknown; categoryId?: unknown; payload?: unknown; baseVersion?: unknown }
  if (typeof body.title !== 'string' || typeof body.categoryId !== 'string' || typeof body.baseVersion !== 'number') return response.status(400).json({ error: { code: 'INVALID_DOCUMENT', message: 'title、categoryId、baseVersion 必填' } })
  const saved = repository.save({ id: String(request.params.documentId), ownerId: request.ownerId!, title: body.title, categoryId: body.categoryId, payload: body.payload, baseVersion: body.baseVersion })
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
