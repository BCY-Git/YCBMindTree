import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { DocumentRecord } from './document-repository.js'
import type { MapPayload } from './mcp.js'

export const mcpDepositCandidateSchema = z.object({
  type: z.enum(['fact', 'result', 'task', 'problem', 'decision', 'knowledge', 'idea']),
  action: z.enum(['keep', 'create', 'update', 'complete', 'append-note']),
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().max(2_000),
  sourceNodeIds: z.array(z.string().uuid()).min(1).max(20),
  targetNodeId: z.string().uuid().nullable(),
}).strict()

export type McpDepositCandidate = z.infer<typeof mcpDepositCandidateSchema>

export type McpDepositBatch = {
  id: string
  ownerId: string
  sourceDocumentId: string
  sourceNodeIds: string[]
  targetDocumentId: string
  expectedVersion: number
  status: 'pending' | 'applied'
  candidates: McpDepositCandidate[]
  changes: string[]
  confirmationToken: string
  createdAt: number
  appliedAt: number | null
}

const previewInputSchema = z.object({
  sourceNodeIds: z.array(z.string().uuid()).min(1).max(80),
  candidates: z.array(mcpDepositCandidateSchema).min(1).max(20),
}).strict()

export function createMcpDepositPreview(document: DocumentRecord, input: z.input<typeof previewInputSchema>): McpDepositBatch {
  const value = previewInputSchema.parse(input)
  const payload = document.payload as MapPayload
  const allowedSources = new Set(value.sourceNodeIds)
  value.sourceNodeIds.forEach((nodeId) => { if (!payload.nodes[nodeId]) throw new Error('来源节点不存在') })
  const changes = value.candidates.map((candidate) => {
    candidate.sourceNodeIds.forEach((nodeId) => { if (!allowedSources.has(nodeId)) throw new Error('候选引用了分析范围之外的来源节点') })
    if (candidate.action === 'keep') return `仅保留原记录「${candidate.title}」`
    const target = candidate.targetNodeId ? payload.nodes[candidate.targetNodeId] : null
    if (!target) throw new Error('候选缺少有效目标节点')
    if (candidate.action === 'create' && target.isFreeTopic) throw new Error('自由主题不能作为新分支父节点')
    if (candidate.action === 'create') return `新增「${candidate.title}」到「${target.topic}」`
    if (candidate.action === 'complete') return `完成任务「${target.topic}」`
    return `${candidate.action === 'update' ? '更新' : '追加备注到'}「${target.topic}」`
  })
  return {
    id: randomUUID(), ownerId: document.ownerId, sourceDocumentId: document.id, sourceNodeIds: value.sourceNodeIds,
    targetDocumentId: document.id, expectedVersion: document.version, status: 'pending', candidates: value.candidates,
    changes, confirmationToken: randomBytes(24).toString('base64url'), createdAt: Date.now(), appliedAt: null,
  }
}

const applyInputSchema = z.object({ confirmed: z.literal(true), confirmationToken: z.string().min(20) }).strict()

export function applyMcpDepositPreview(document: DocumentRecord, batch: McpDepositBatch, input: z.input<typeof applyInputSchema>): { payload: MapPayload; affectedNodeIds: string[] } {
  const value = applyInputSchema.parse(input)
  if (batch.status !== 'pending') throw new Error('沉淀批次已经处理')
  if (batch.ownerId !== document.ownerId || batch.targetDocumentId !== document.id) throw new Error('沉淀批次与目标导图不匹配')
  if (batch.expectedVersion !== document.version) throw new Error('导图在预览后已发生变化')
  if (batch.confirmationToken !== value.confirmationToken) throw new Error('确认令牌无效')
  const payload = structuredClone(document.payload) as MapPayload
  const affectedNodeIds: string[] = []
  const now = Date.now()
  const appendNote = (current: string, addition: string) => [current.trim(), addition.trim()].filter(Boolean).join('\n')
  batch.candidates.forEach((candidate) => {
    if (candidate.action === 'keep') return
    const target = candidate.targetNodeId ? payload.nodes[candidate.targetNodeId] : null
    if (!target) throw new Error('候选目标节点已经不存在')
    if (candidate.action === 'create') {
      const id = randomUUID()
      payload.nodes[id] = { id, parentId: target.id, isFreeTopic: false, childIds: [], topic: candidate.title, note: candidate.detail, links: [], attachments: [], taskStatus: candidate.type === 'task' ? 'todo' : 'none', priority: 0, dueDate: null, marks: candidate.type === 'idea' ? ['idea'] : [], tagIds: [], collapsed: false, width: null, height: null, offsetX: 0, offsetY: 0, createdAt: now, updatedAt: now }
      target.childIds.push(id)
      target.collapsed = false
      target.updatedAt = now
      affectedNodeIds.push(id)
      return
    }
    if (candidate.action === 'complete') target.taskStatus = 'done'
    target.note = candidate.action === 'update' ? (candidate.detail || candidate.title) : appendNote(target.note, candidate.detail || candidate.title)
    target.updatedAt = now
    affectedNodeIds.push(target.id)
  })
  return { payload, affectedNodeIds }
}
