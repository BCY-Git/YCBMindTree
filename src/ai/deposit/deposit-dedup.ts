import type { DepositCandidate, DepositCandidateType } from '@/ai/deposit/deposit-types'

function normalized(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

export function depositFingerprint(sourceDocumentId: string, sourceNodeIds: readonly string[], title: string, type: DepositCandidateType) {
  return `${sourceDocumentId}:${[...sourceNodeIds].sort().join(',')}:${normalized(title)}:${type}`
}

export function withDuplicateFlags(candidates: DepositCandidate[], appliedFingerprints: ReadonlySet<string>) {
  return candidates.map((candidate) => appliedFingerprints.has(candidate.fingerprint)
    ? { ...candidate, duplicateOfCandidateId: candidate.id, status: 'pending' as const }
    : candidate)
}
