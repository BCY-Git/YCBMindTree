import { beforeEach, describe, expect, it } from 'vitest'
import { readSearchUsageSummary, recordAiRetrievalUsage, recordWorkspaceSearchClick, recordWorkspaceSearchUsage } from '@/search/search-usage-metrics'

describe('privacy-safe search usage metrics', () => {
  beforeEach(() => localStorage.clear())

  it('stores scope, filter count and result count without persisting query text', () => {
    recordWorkspaceSearchUsage({
      scope: 'workspace',
      filterKinds: ['tag', 'status'],
      resultCount: 7,
      query: '不能保存的私人原文',
    } as never)

    expect(readSearchUsageSummary().searches).toMatchObject({ total: 1, workspace: 1, withSemanticFilters: 1 })
    expect(JSON.stringify(readSearchUsageSummary())).not.toContain('不能保存的私人原文')
  })

  it('aggregates click rank, cross-map location and bounded AI retrieval outcomes', () => {
    recordWorkspaceSearchClick({ rank: 2, crossDocument: true })
    recordAiRetrievalUsage({ resultCount: 0, limit: 12 })
    recordAiRetrievalUsage({ resultCount: 12, limit: 12 })

    expect(readSearchUsageSummary()).toMatchObject({
      clicks: { total: 1, totalRank: 2, crossDocument: 1 },
      aiRetrievals: { total: 2, empty: 1, limitReached: 1, totalResults: 12 },
    })
  })
})
