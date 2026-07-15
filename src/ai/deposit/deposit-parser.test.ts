import { describe, expect, it } from 'vitest'
import { depositFingerprint } from './deposit-dedup'
import { parseDepositAnalysis } from './deposit-parser'

describe('deposit analysis parser', () => {
  const input = { sourceNodeIds: ['source-1'], destinationNodeIdsByDocument: { 'doc-1': ['root', 'project'] } }

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

  it('accepts a target from another supplied workspace document', () => {
    const proposal = parseDepositAnalysis(JSON.stringify({
      summary: '回流项目',
      candidates: [{ type: 'result', title: 'PPT 已交付', detail: '已经发给负责人。', sourceNodeIds: ['source-1'], action: 'append-note', suggestedDocumentId: 'project-doc', suggestedParentId: null, suggestedTargetNodeId: 'project-node', confidence: 0.95, reason: '明确的项目成果。' }],
    }), { sourceNodeIds: ['source-1'], destinationNodeIdsByDocument: { 'doc-1': ['root'], 'project-doc': ['project-node'] } })

    expect(proposal.candidates[0]).toMatchObject({ suggestedDocumentId: 'project-doc', suggestedTargetNodeId: 'project-node' })
  })
})
