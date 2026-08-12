import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'node:crypto'
import type { Express } from 'express'
import { requireAccountBearer, type AuthenticatedRequest } from './auth.js'
import type { DocumentRepository } from './document-repository.js'
import type { AppOptions } from './http-options.js'
import { createMindTreeMcp } from './mcp.js'

/** MCP SDK 直接操作 Node request/response，保留为 Express 适配层。 */
export function attachMcpRoute(app: Express, repository: DocumentRepository, options: AppOptions): void {
  app.use('/mcp', requireAccountBearer(repository, options.devToken))
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; close: () => Promise<void> }>()

  async function createSession() {
    const mcp = createMindTreeMcp(repository)
    let transport!: StreamableHTTPServerTransport
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => { sessions.set(sessionId, { transport, close: () => mcp.close() }) },
      onsessionclosed: async (sessionId) => {
        const session = sessions.get(sessionId)
        sessions.delete(sessionId)
        await session?.close()
      },
    })
    await mcp.connect(transport)
    return transport
  }

  app.all('/mcp', async (request: AuthenticatedRequest, response) => {
    try {
      const sessionId = request.header('mcp-session-id')
      const session = sessionId ? sessions.get(sessionId) : undefined
      if (sessionId && !session) return response.status(404).json({ error: { code: 'MCP_SESSION_NOT_FOUND', message: 'MCP 会话不存在或已过期' } })
      const transport = session?.transport ?? await createSession()
      await transport.handleRequest(request as never, response, request.body)
    } catch (error) {
      console.error('MCP request failed', error)
      if (!response.headersSent) response.status(500).json({ error: { code: 'MCP_REQUEST_FAILED', message: error instanceof Error ? error.message : 'MCP 请求失败' } })
    }
  })
}
