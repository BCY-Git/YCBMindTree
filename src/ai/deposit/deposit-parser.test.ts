import { describe, expect, it } from 'vitest'
import { depositFingerprint } from './deposit-dedup'
import { parseDepositAnalysis } from './deposit-parser'

describe('deposit analysis parser', () => {
  const input = { sourceNodeIds: ['source-1'], documentId: 'doc-1', destinationNodeIds: ['root', 'project'] }

  it('accepts structured candidates and clears target IDs outside the supplied whitelist', () => {
    const proposal = parseDepositAnalysis(JSON.stringify({
      summary: '识别到一个任务',
      candidates: [{ type: 'task', title: '修改地图瓦片路径', detail: '出差前完成。', sourceNodeIds: ['source-1'], action: 'create', suggestedDocumentId: 'doc-1', suggestedParentId: 'unknown', suggestedTargetNodeId: 'project', confidence: 0.91, reason: '原文明确是后续动作。' }],
    }), input)

    expect(proposal.candidates[0]).toMatchObject({ suggestedDocumentId: 'doc-1', suggestedParentId: null, suggestedTargetNodeId: 'project' })
  })

  it('rejects candidates that claim an out-of-scope source node', () => {
    expect(() => parseDepositAnalysis(JSON.stringify({
      summary: '',
      candidates: [{ type: 'idea', title: '视频关键帧', detail: '', sourceNodeIds: ['not-provided'], action: 'keep', suggestedDocumentId: null, suggestedParentId: null, suggestedTargetNodeId: null, confidence: 0.5, reason: '' }],
    }), input)).toThrow('分析范围之外')
  })

  it('creates stable fingerprints regardless of source-node order', () => {
    expect(depositFingerprint('doc-1', ['b', 'a'], '  Zod 运行时验证 ', 'knowledge')).toBe(depositFingerprint('doc-1', ['a', 'b'], 'zod   运行时验证', 'knowledge'))
  })
})
