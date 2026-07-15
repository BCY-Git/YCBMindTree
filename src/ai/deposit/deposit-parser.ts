import { depositAnalysisSchema } from './deposit-schema'
import type { DepositAnalysisProposal } from './deposit-types'

function extractJson(content: string) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(trimmed) as unknown } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('模型没有返回合法 JSON。')
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown
  }
}

/** 模型输出是不可信输入：结构由 Zod 校验，ID 再由本地白名单收紧。 */
export function parseDepositAnalysis(content: string, input: {
  sourceNodeIds: readonly string[]
  documentId: string
  destinationNodeIds: readonly string[]
}): DepositAnalysisProposal {
  const parsed = depositAnalysisSchema.parse(extractJson(content))
  const allowedSources = new Set(input.sourceNodeIds)
  const allowedNodes = new Set(input.destinationNodeIds)
  return {
    summary: parsed.summary,
    candidates: parsed.candidates.map((candidate) => {
      if (candidate.sourceNodeIds.some((id) => !allowedSources.has(id))) throw new Error('模型引用了分析范围之外的来源节点。')
      const sameDocument = candidate.suggestedDocumentId === input.documentId
      return {
        ...candidate,
        sourceNodeIds: [...new Set(candidate.sourceNodeIds)],
        suggestedDocumentId: sameDocument ? input.documentId : null,
        suggestedParentId: sameDocument && candidate.suggestedParentId && allowedNodes.has(candidate.suggestedParentId) ? candidate.suggestedParentId : null,
        suggestedTargetNodeId: sameDocument && candidate.suggestedTargetNodeId && allowedNodes.has(candidate.suggestedTargetNodeId) ? candidate.suggestedTargetNodeId : null,
      }
    }),
  }
}
