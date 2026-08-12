import { describe, expect, it } from 'vitest'
import { candidateMetricType, confirmationDuration } from '@/ai/deposit/deposit-metrics'

describe('deposit quality metrics', () => {
  it('separates candidate edits, target reselection and status decisions', () => {
    expect(candidateMetricType({ title: '修改后的结论' })).toBe('modified')
    expect(candidateMetricType({ action: 'append-note' })).toBe('modified')
    expect(candidateMetricType({ suggestedParentId: 'target-2' })).toBe('target-reselected')
    expect(candidateMetricType({ status: 'accepted' })).toBe('accepted')
    expect(candidateMetricType({ status: 'pending' })).toBeNull()
  })

  it('measures confirmation time from candidate generation and never returns a negative value', () => {
    expect(confirmationDuration({ createdAt: 1_000 }, 4_500)).toBe(3_500)
    expect(confirmationDuration({ createdAt: 5_000 }, 4_500)).toBe(0)
  })
})
