import { z } from 'zod'
import { depositActions, depositCandidateTypes } from '@/ai/deposit/deposit-types'

const nullableId = z.string().min(1).nullable().optional().default(null)

export const depositAnalysisSchema = z.object({
  summary: z.string().trim().max(500).default(''),
  candidates: z.array(z.object({
    type: z.enum(depositCandidateTypes),
    title: z.string().trim().min(1).max(160),
    detail: z.string().trim().max(2_000).default(''),
    sourceNodeIds: z.array(z.string().min(1)).min(1).max(20),
    action: z.enum(depositActions),
    suggestedDocumentId: nullableId,
    suggestedParentId: nullableId,
    suggestedTargetNodeId: nullableId,
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().max(500).default(''),
  })).max(20),
})
