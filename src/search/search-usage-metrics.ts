export type SearchScope = 'current-document' | 'workspace'
export type SearchFilterKind = 'document' | 'tag' | 'mark' | 'status' | 'priority' | 'provenance'

export type SearchUsageSummary = {
  version: 1
  searches: {
    total: number
    currentDocument: number
    workspace: number
    withSemanticFilters: number
    totalFilterKinds: number
    totalResults: number
  }
  clicks: { total: number; totalRank: number; crossDocument: number }
  aiRetrievals: { total: number; empty: number; limitReached: number; totalResults: number }
}

const storageKey = 'mindtree.search-usage-summary.v1'

function emptySummary(): SearchUsageSummary {
  return {
    version: 1,
    searches: { total: 0, currentDocument: 0, workspace: 0, withSemanticFilters: 0, totalFilterKinds: 0, totalResults: 0 },
    clicks: { total: 0, totalRank: 0, crossDocument: 0 },
    aiRetrievals: { total: 0, empty: 0, limitReached: 0, totalResults: 0 },
  }
}

export function readSearchUsageSummary(): SearchUsageSummary {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as SearchUsageSummary | null
    return stored?.version === 1 ? stored : emptySummary()
  } catch {
    return emptySummary()
  }
}

function writeSummary(summary: SearchUsageSummary) {
  localStorage.setItem(storageKey, JSON.stringify(summary))
}

/** 只接受聚合维度；函数不会读取或序列化查询、节点、标签名称等原文。 */
export function recordWorkspaceSearchUsage(input: { scope: SearchScope; filterKinds: SearchFilterKind[]; resultCount: number }) {
  const summary = readSearchUsageSummary()
  summary.searches.total += 1
  summary.searches[input.scope === 'workspace' ? 'workspace' : 'currentDocument'] += 1
  summary.searches.withSemanticFilters += Number(input.filterKinds.length > 0)
  summary.searches.totalFilterKinds += input.filterKinds.length
  summary.searches.totalResults += Math.max(0, input.resultCount)
  writeSummary(summary)
}

export function recordWorkspaceSearchClick(input: { rank: number; crossDocument: boolean }) {
  const summary = readSearchUsageSummary()
  summary.clicks.total += 1
  summary.clicks.totalRank += Math.max(1, Math.floor(input.rank))
  summary.clicks.crossDocument += Number(input.crossDocument)
  writeSummary(summary)
}

export function recordAiRetrievalUsage(input: { resultCount: number; limit: number }) {
  const summary = readSearchUsageSummary()
  const resultCount = Math.max(0, input.resultCount)
  summary.aiRetrievals.total += 1
  summary.aiRetrievals.empty += Number(resultCount === 0)
  summary.aiRetrievals.limitReached += Number(input.limit > 0 && resultCount >= input.limit)
  summary.aiRetrievals.totalResults += resultCount
  writeSummary(summary)
}
