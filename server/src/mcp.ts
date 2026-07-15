import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { DocumentRepository, type DocumentRecord } from './document-repository.js'
import { applyMcpDepositPreview, createMcpDepositPreview, mcpDepositCandidateSchema } from './mcp-deposit.js'

type Branch = { topic: string; children: Branch[] }

const branchSchema: z.ZodType<Branch> = z.object({
  topic: z.string().trim().min(1).max(160),
  children: z.array(z.lazy(() => branchSchema)).default([]),
})

export type MapPayload = {
  id: string
  rootId: string
  nodes: Record<string, { id: string; parentId: string | null; isFreeTopic: boolean; childIds: string[]; topic: string; note: string; links: unknown[]; attachments: unknown[]; taskStatus: 'none' | 'todo' | 'doing' | 'done'; priority: 0 | 1 | 2 | 3; dueDate: string | null; marks: Array<'flag' | 'star' | 'risk' | 'idea'>; tagIds: string[]; collapsed: boolean; width: number | null; height: number | null; offsetX: number; offsetY: number; createdAt: number; updatedAt: number }>
}

export function buildMcpDepositContext(payload: MapPayload, sourceNodeId: string, limit = 80) {
  const source = payload.nodes[sourceNodeId]
  if (!source) throw new Error('来源节点不存在')
  const ordered: Array<MapPayload['nodes'][string]> = []
  const visit = (nodeId: string) => {
    const node = payload.nodes[nodeId]
    if (!node) return
    ordered.push(node)
    node.childIds.forEach(visit)
  }
  visit(source.id)
  return {
    sourceNodeId,
    totalNodeCount: ordered.length,
    truncated: ordered.length > limit,
    nodes: ordered.slice(0, limit).map(({ id, parentId, topic, note, taskStatus, priority, dueDate, marks, tagIds }) => ({ id, parentId, topic, note, taskStatus, priority, dueDate, marks, tagIds })),
  }
}

function text(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], isError }
}

function ownerId(extra: { authInfo?: { clientId: string } }) {
  return extra.authInfo?.clientId ?? 'local-user'
}

export function insertBranch(payload: MapPayload, parentId: string, branch: z.infer<typeof branchSchema>) {
  const parent = payload.nodes[parentId]
  if (!parent) throw new Error('目标节点不存在')
  const now = Date.now()
  const create = (source: z.infer<typeof branchSchema>, parentNodeId: string): string => {
    const id = randomUUID()
    const node = { id, parentId: parentNodeId, isFreeTopic: false, childIds: [] as string[], topic: source.topic, note: '', links: [], attachments: [], taskStatus: 'none' as const, priority: 0 as const, dueDate: null, marks: [], tagIds: [], collapsed: false, width: null, height: null, offsetX: 0, offsetY: 0, createdAt: now, updatedAt: now }
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

  server.registerTool('mindtree_analyze_deposit', {
    title: '读取智能沉淀分析范围',
    description: '读取一个受限子树供 Agent 识别沉淀候选。只读取，不生成批次或修改导图。',
    inputSchema: z.object({ documentId: z.string().uuid(), sourceNodeId: z.string().uuid() }),
    annotations: { readOnlyHint: true },
  }, async ({ documentId, sourceNodeId }, extra) => {
    try {
      const document = documentForOwner(repository, ownerId(extra), documentId)
      const context = buildMcpDepositContext(document.payload as MapPayload, sourceNodeId)
      return text({ documentId, currentVersion: document.version, context, candidateProtocol: { maxCandidates: 20, actions: ['keep', 'create', 'update', 'complete', 'append-note'], note: '调用 mindtree_preview_deposit_plan 提交候选；该步骤仍不会修改导图。' } })
    } catch (error) {
      return text({ error: error instanceof Error ? error.message : '分析范围读取失败' }, true)
    }
  })

  server.registerTool('mindtree_preview_deposit_plan', {
    title: '预览智能沉淀计划',
    description: '校验 Agent 生成的候选并保存待确认批次。不会修改导图；返回的一次性令牌只能用于该预览。',
    inputSchema: z.object({
      documentId: z.string().uuid(),
      baseVersion: z.number().int().nonnegative(),
      sourceNodeIds: z.array(z.string().uuid()).min(1).max(80),
      candidates: z.array(mcpDepositCandidateSchema).min(1).max(20),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
  }, async ({ documentId, baseVersion, sourceNodeIds, candidates }, extra) => {
    try {
      const document = documentForOwner(repository, ownerId(extra), documentId)
      if (document.version !== baseVersion) return text({ error: 'VERSION_CONFLICT', currentVersion: document.version }, true)
      const batch = createMcpDepositPreview(document, { sourceNodeIds, candidates })
      repository.saveMcpDepositBatch(batch)
      return text({ batchId: batch.id, status: batch.status, currentVersion: document.version, changes: batch.changes, confirmationToken: batch.confirmationToken, warning: '导图尚未修改。只有用户核对变化后才能调用 mindtree_apply_deposit_plan。' })
    } catch (error) {
      return text({ error: error instanceof Error ? error.message : '预览生成失败' }, true)
    }
  })

  server.registerTool('mindtree_apply_deposit_plan', {
    title: '应用已确认的智能沉淀计划',
    description: '应用此前预览的单导图沉淀计划。必须由用户核对预览后提供一次性令牌并显式确认；版本变化会阻止写入。',
    inputSchema: z.object({ batchId: z.string().uuid(), confirmationToken: z.string().min(20), confirmed: z.literal(true) }),
    annotations: { destructiveHint: false, idempotentHint: false },
  }, async ({ batchId, confirmationToken, confirmed }, extra) => {
    try {
      const owner = ownerId(extra)
      const batch = repository.getMcpDepositBatch(owner, batchId)
      if (!batch) return text({ error: '沉淀批次不存在或无权访问' }, true)
      const document = documentForOwner(repository, owner, batch.targetDocumentId)
      const result = applyMcpDepositPreview(document, batch, { confirmationToken, confirmed })
      const saved = repository.applyMcpDepositBatch(document, batch, result.payload)
      if ('type' in saved) return text({ error: saved.type, currentVersion: saved.document.version }, true)
      return text({ batchId, status: 'applied', documentId: saved.id, version: saved.version, affectedNodeIds: result.affectedNodeIds })
    } catch (error) {
      return text({ error: error instanceof Error ? error.message : '沉淀写入失败' }, true)
    }
  })

  server.registerTool('mindtree_list_deposit_batches', {
    title: '列出智能沉淀批次',
    description: '列出当前用户待审查或已应用的 MCP 沉淀批次摘要，不返回确认令牌。',
    inputSchema: z.object({ status: z.enum(['pending', 'applied']).default('pending') }),
    annotations: { readOnlyHint: true },
  }, async ({ status }, extra) => {
    const batches = repository.listMcpDepositBatches(ownerId(extra), status).map((batch) => ({
      batchId: batch.id, sourceDocumentId: batch.sourceDocumentId, targetDocumentId: batch.targetDocumentId,
      expectedVersion: batch.expectedVersion, status: batch.status, candidateCount: batch.candidates.length,
      changes: batch.changes, createdAt: batch.createdAt, appliedAt: batch.appliedAt,
    }))
    return text({ batches })
  })

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
