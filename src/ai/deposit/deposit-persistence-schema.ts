import { z } from 'zod'
import { depositActions, depositCandidateTypes } from './deposit-types'

export const depositCandidateSchema = z.object({
  id: z.string().min(1),
  batchId: z.string().min(1),
  type: z.enum(depositCandidateTypes),
  title: z.string().min(1).max(160),
  detail: z.string().max(2_000),
  sourceNodeIds: z.array(z.string().min(1)).min(1).max(20),
  suggestedDocumentId: z.string().min(1).nullable(),
  suggestedParentId: z.string().min(1).nullable(),
  suggestedTargetNodeId: z.string().min(1).nullable(),
  action: z.enum(depositActions),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(500),
  duplicateOfCandidateId: z.string().min(1).nullable(),
  status: z.enum(['pending', 'accepted', 'ignored', 'applied', 'failed']),
  fingerprint: z.string().min(1),
})

export const depositBatchSchema = z.object({
  id: z.string().min(1),
  sourceDocumentId: z.string().min(1),
  sourceNodeIds: z.array(z.string().min(1)).min(1),
  scope: z.enum(['node', 'subtree', 'document']),
  sourceDocumentUpdatedAt: z.number(),
  sourceSnapshot: z.string().max(12_000),
  status: z.enum(['generating', 'pending', 'applied', 'failed']),
  summary: z.string().max(500),
  candidates: z.array(depositCandidateSchema).max(20),
  createdAt: z.number(),
  updatedAt: z.number(),
  appliedAt: z.number().nullable(),
})

export const depositProvenanceSchema = z.object({
  id: z.string().min(1),
  batchId: z.string().min(1),
  candidateId: z.string().min(1),
  sourceDocumentId: z.string().min(1),
  sourceNodeIds: z.array(z.string().min(1)).min(1),
  sourceSnapshot: z.string().max(12_000),
  targetDocumentId: z.string().min(1).nullable(),
  targetNodeIds: z.array(z.string().min(1)),
  action: z.enum(depositActions),
  model: z.string(),
  acceptedByUser: z.boolean(),
  createdAt: z.number(),
})
