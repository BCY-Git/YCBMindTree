import { z } from 'zod'
import { workflowModes, workflowPhases } from '@/ai/workflow/workflow-types'

const shortList = z.array(z.string().trim().min(1).max(500)).max(20)

export const workflowCheckpointSchema = z.object({
  confirmed: shortList,
  rejected: shortList,
  constraints: shortList,
  openQuestions: shortList,
  nextActions: shortList,
})

export const workflowSessionSchema = z.object({
  id: z.string().min(1), documentId: z.string().min(1), focusNodeId: z.string().min(1),
  mode: z.enum(workflowModes), phase: z.enum(workflowPhases), status: z.enum(['active', 'completed']),
  goal: z.string().max(2_000), audience: z.string().max(1_000), deliverable: z.string().max(2_000),
  constraints: shortList, acceptanceCriteria: shortList, confirmedFacts: shortList, rejectedOptions: shortList, openQuestions: shortList, nextActions: shortList,
  checkpoints: z.array(z.object({ id: z.string().min(1), confirmed: shortList, rejected: shortList, constraints: shortList, openQuestions: shortList, nextActions: shortList, sourceNodeIds: z.array(z.string().min(1)), createdAt: z.number() })).max(100),
  createdAt: z.number(), updatedAt: z.number(), completedAt: z.number().nullable(),
})

function extractJson(content: string) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(trimmed) as unknown } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('模型没有返回合法的检查点 JSON。')
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown
  }
}

export function parseWorkflowCheckpoint(content: string) {
  return workflowCheckpointSchema.parse(extractJson(content))
}
