import type { DepositCandidate } from './deposit-types'

export type CandidateMetricType = 'accepted' | 'ignored' | 'target-reselected' | 'modified'

export function candidateMetricType(patch: Partial<DepositCandidate>): CandidateMetricType | null {
  if (patch.status === 'accepted') return 'accepted'
  if (patch.status === 'ignored') return 'ignored'
  if (patch.suggestedDocumentId !== undefined || patch.suggestedParentId !== undefined || patch.suggestedTargetNodeId !== undefined) return 'target-reselected'
  if (patch.type !== undefined || patch.action !== undefined || patch.title !== undefined || patch.detail !== undefined) return 'modified'
  return null
}

export function confirmationDuration(batch: { createdAt: number }, confirmedAt = Date.now()): number {
  return Math.max(0, confirmedAt - batch.createdAt)
}
