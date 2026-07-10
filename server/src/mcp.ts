import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { DocumentRepository, type DocumentRecord } from './document-repository.js'

type Branch = { topic: string; children: Branch[] }

const branchSchema: z.ZodType<Branch> = z.object({
  topic: z.string().trim().min(1).max(160),
  children: z.array(z.lazy(() => branchSchema)).default([]),
})

type MapPayload = {
  id: string
  rootId: string
  nodes: Record<string, { id: string; parentId: string | null; childIds: string[]; topic: string; collapsed: boolean; offsetX: number; offsetY: number; createdAt: number; updatedAt: number }>
}

function text(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], isError }
}

function ownerId(extra: { authInfo?: { clientId: string } }) {
  return extra.authInfo?.clientId ?? 'local-user'
}

function insertBranch(payload: MapPayload, parentId: string, branch: z.infer<typeof branchSchema>) {
  const parent = payload.nodes[parentId]
  if (!parent) throw new Error('目标节点不存在')
  const now = Date.now()
  const create = (source: z.infer<typeof branchSchema>, parentNodeId: string): string => {
    const id = randomUUID()
    const node = { id, parentId: parentNodeId, childIds: [] as string[], topic: source.topic, collapsed: false, offsetX: 0, offsetY: 0, createdAt: now, updatedAt: now }
    payload.nodes[id] = node
    node.childIds = source.children.map((child) => create(child, id))
    return id
  }
  const rootId = create(branch, parent.id)
  parent.childIds.push(rootId)
  parent.collapsed = false
  parent.updatedAt = now
  return rootId
}

function documentForOwner(repository: DocumentRepository, owner: string, documentId: string) {
  const document = repository.get(owner, documentId)
  if (!document) throw new Error('导图不存在或无权访问')
  return document
}

export function createMindTreeMcp(repository: DocumentRepository) {
  const server = new McpServer({ name: 'mindtree-mcp', version: '0.1.0' })

  server.registerTool('mindtree_list_documents', {
    title: '列出 MindTree 导图',
    description: '列出当前用户可访问的思维导图摘要与版本号。',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async (_, extra) => text(repository.list(ownerId(extra)).map(({ payload: _payload, ...document }) => document)))

  server.registerTool('mindtree_get_document', {
    title: '读取 MindTree 导图',
    description: '读取指定导图的完整树结构、主题和当前版本。',
    inputSchema: z.object({ documentId: z.string().uuid() }),
    annotations: { readOnlyHint: true },
  }, async ({ documentId }, extra) => {
    try { return text(documentForOwner(repository, ownerId(extra), documentId)) } catch (error) { return text({ error: error instanceof Error ? error.message : '读取失败' }, true) }
  })

  server.registerTool('mindtree_search_nodes', {
    title: '搜索 MindTree 节点',
    description: '在当前用户的导图中按关键词搜索节点主题。',
    inputSchema: z.object({ query: z.string().trim().min(1).max(100) }),
    annotations: { readOnlyHint: true },
  }, async ({ query }, extra) => text(repository.searchNodes(ownerId(extra), query)))

  server.registerTool('mindtree_append_branch', {
    title: '向节点添加 MindTree 分支',
    description: '向目标节点添加一棵子树。默认只预览；apply=true 且版本匹配时才会写入。',
    inputSchema: z.object({
      documentId: z.string().uuid(),
      parentNodeId: z.string().uuid(),
      branch: branchSchema,
      dryRun: z.boolean().default(true),
      baseVersion: z.number().int().nonnegative().optional(),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
  }, async ({ documentId, parentNodeId, branch, dryRun, baseVersion }, extra) => {
    try {
      const owner = ownerId(extra)
      const document = documentForOwner(repository, owner, documentId)
      if (dryRun) return text({ dryRun: true, target: parentNodeId, currentVersion: document.version, branch })
      if (baseVersion === undefined) return text({ error: 'apply=true 时必须提供 baseVersion' }, true)
      const payload = structuredClone(document.payload) as MapPayload
      const insertedNodeId = insertBranch(payload, parentNodeId, branch)
      const saved = repository.save({ id: document.id, ownerId: owner, title: document.title, categoryId: document.categoryId, payload, baseVersion, kind: 'mcp_append_branch' })
      if ('type' in saved) return text({ error: saved.type, currentVersion: saved.document.version }, true)
      return text({ dryRun: false, insertedNodeId, version: saved.version })
    } catch (error) {
      return text({ error: error instanceof Error ? error.message : '写入失败' }, true)
    }
  })

  return server
}
