import { describe, expect, it } from 'vitest'
import { evaluateSearchResults, evaluateSearchSuite } from './search-quality'
import { runFixedSearchQualitySuite } from './search-quality-fixtures'

describe('workspace search quality', () => {
  it('reports Recall@5 and reciprocal rank from ranked node keys', () => {
    const result = evaluateSearchResults({
      rankedNodeKeys: ['map-a\u0000noise', 'map-b\u0000answer'],
      expectedNodeKeys: ['map-b\u0000answer'],
      forbiddenNodeKeys: [],
    })

    expect(result).toMatchObject({ recallAt5: 1, reciprocalRank: 0.5 })
  })

  it('reports the share of forbidden results inside the first five results', () => {
    const result = evaluateSearchResults({
      rankedNodeKeys: ['map-a\u0000answer', 'map-a\u0000forbidden'],
      expectedNodeKeys: ['map-a\u0000answer'],
      forbiddenNodeKeys: ['map-a\u0000forbidden'],
    })

    expect(result.irrelevantRateAt5).toBe(0.5)
  })

  it('aggregates repeatable cases and verifies selected results can be located', () => {
    const report = evaluateSearchSuite([{
      id: 'learning-boundary',
      category: 'learning',
      rankedNodeKeys: ['learning-map\u0000zod'],
      expectedNodeKeys: ['learning-map\u0000zod'],
      forbiddenNodeKeys: [],
    }], (nodeKey) => nodeKey === 'learning-map\u0000zod')

    expect(report.summary).toEqual({
      caseCount: 1,
      recallAt5: 1,
      meanReciprocalRank: 1,
      irrelevantRateAt5: 0,
      crossMapLocationSuccessRate: 1,
    })
  })

  it('keeps all four anonymous real-use scenarios above the 1.7 quality threshold', () => {
    const report = runFixedSearchQualitySuite()

    expect(report.cases.map((item) => item.category)).toEqual(['daily', 'learning', 'decision', 'idea'])
    expect(report.summary).toMatchObject({
      caseCount: 4,
      recallAt5: 1,
      meanReciprocalRank: 1,
      irrelevantRateAt5: 0,
      crossMapLocationSuccessRate: 1,
    })
  })
})
