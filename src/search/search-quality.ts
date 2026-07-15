export type RankedSearchQualityInput = {
  rankedNodeKeys: string[]
  expectedNodeKeys: string[]
  forbiddenNodeKeys: string[]
}

export type RankedSearchQuality = {
  recallAt5: number
  reciprocalRank: number
  irrelevantRateAt5: number
}

export type SearchQualityCategory = 'daily' | 'learning' | 'decision' | 'idea'

export type SearchQualityCase = RankedSearchQualityInput & {
  id: string
  category: SearchQualityCategory
}

export type SearchQualityReport = {
  cases: Array<SearchQualityCase & RankedSearchQuality & { crossMapLocationSuccess: boolean }>
  summary: {
    caseCount: number
    recallAt5: number
    meanReciprocalRank: number
    irrelevantRateAt5: number
    crossMapLocationSuccessRate: number
  }
}

/** 用稳定节点键评估排序结果；不接触或保存查询与节点原文。 */
export function evaluateSearchResults({ rankedNodeKeys, expectedNodeKeys, forbiddenNodeKeys }: RankedSearchQualityInput): RankedSearchQuality {
  const top5 = rankedNodeKeys.slice(0, 5)
  const expected = new Set(expectedNodeKeys)
  const forbidden = new Set(forbiddenNodeKeys)
  const matchedExpected = new Set(top5.filter((key) => expected.has(key)))
  const firstRelevantIndex = rankedNodeKeys.findIndex((key) => expected.has(key))
  return {
    recallAt5: expected.size ? matchedExpected.size / expected.size : 1,
    reciprocalRank: firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1),
    irrelevantRateAt5: top5.length ? top5.filter((key) => forbidden.has(key)).length / top5.length : 0,
  }
}

export function evaluateSearchSuite(cases: SearchQualityCase[], canLocate: (nodeKey: string) => boolean): SearchQualityReport {
  const evaluated = cases.map((qualityCase) => {
    const metrics = evaluateSearchResults(qualityCase)
    const top5 = new Set(qualityCase.rankedNodeKeys.slice(0, 5))
    const crossMapLocationSuccess = qualityCase.expectedNodeKeys.every((key) => top5.has(key) && canLocate(key))
    return { ...qualityCase, ...metrics, crossMapLocationSuccess }
  })
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  return {
    cases: evaluated,
    summary: {
      caseCount: evaluated.length,
      recallAt5: average(evaluated.map((item) => item.recallAt5)),
      meanReciprocalRank: average(evaluated.map((item) => item.reciprocalRank)),
      irrelevantRateAt5: average(evaluated.map((item) => item.irrelevantRateAt5)),
      crossMapLocationSuccessRate: average(evaluated.map((item) => Number(item.crossMapLocationSuccess))),
    },
  }
}
