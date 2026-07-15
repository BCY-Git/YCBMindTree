import type { LocalDepositOperation } from '../../domain/commands'
import type { MindNodePriority, MindNodeTaskStatus, NodeMark } from '../../domain/document.types'

export const depositCandidateTypes = ['fact', 'result', 'task', 'problem', 'decision', 'knowledge', 'idea'] as const
export type DepositCandidateType = typeof depositCandidateTypes[number]

export const depositActions = ['keep', 'create', 'update', 'complete', 'append-note'] as const
export type DepositAction = typeof depositActions[number]
export type DepositCandidateStatus = 'pending' | 'accepted' | 'ignored' | 'applied' | 'failed'

export type DepositCandidate = {
  id: string
  batchId: string
  type: DepositCandidateType
  title: string
  detail: string
  sourceNodeIds: string[]
  suggestedDocumentId: string | null
  suggestedParentId: string | null
  suggestedTargetNodeId: string | null
  action: DepositAction
  confidence: number
  reason: string
  duplicateOfCandidateId: string | null
  status: DepositCandidateStatus
  fingerprint: string
}

export type DepositBatchStatus = 'generating' | 'pending' | 'applied' | 'failed'

export type DepositBatch = {
  id: string
  sourceDocumentId: string
  sourceNodeIds: string[]
  scope: 'node' | 'subtree' | 'document'
  sourceDocumentUpdatedAt: number
  sourceSnapshot: string
  status: DepositBatchStatus
  summary: string
  candidates: DepositCandidate[]
  createdAt: number
  updatedAt: number
  appliedAt: number | null
}

export type DepositProvenance = {
  id: string
  batchId: string
  candidateId: string
  sourceDocumentId: string
  sourceNodeIds: string[]
  sourceSnapshot: string
  targetDocumentId: string | null
  targetNodeIds: string[]
  action: DepositAction
  model: string
  acceptedByUser: boolean
  createdAt: number
}

export type DepositContextNode = {
  id: string
  path: string[]
  topic: string
  note: string
  taskStatus: MindNodeTaskStatus
  priority: MindNodePriority
  dueDate: string | null
  marks: NodeMark[]
  tagIds: string[]
}

export type DepositAnalysisContext = {
  source: {
    documentId: string
    title: string
    rootId: string
    selectedNodeIds: string[]
    nodes: DepositContextNode[]
    totalNodeCount: number
    truncated: boolean
  }
  destinations: Array<{
    documentId: string
    title: string
    candidateNodes: Array<{ id: string; path: string[]; topic: string }>
    totalNodeCount: number
    truncated: boolean
  }>
  alreadyAppliedFingerprints: string[]
}

export type DepositAnalysisProposal = {
  summary: string
  candidates: Array<Omit<DepositCandidate, 'id' | 'batchId' | 'duplicateOfCandidateId' | 'status' | 'fingerprint'>>
}

export type { LocalDepositOperation }

export type DepositPlan = {
  batchId: string
  expectedDocumentUpdatedAt: number
  operations: LocalDepositOperation[]
  includedCandidateIds: string[]
}
