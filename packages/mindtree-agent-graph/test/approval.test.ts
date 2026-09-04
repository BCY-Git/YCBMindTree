import { describe, expect, it } from 'vitest'
import { buildBatchReviewPayload, resolveDecision } from '../src/approval.js'
import type { CandidateProposal } from '../src/state.js'

describe('buildBatchReviewPayload', () => {
  it('把整批候选原样打包，附带类型标记', () => {
    const candidates: CandidateProposal[] = [{ id: 'c1', toolName: 'propose_create_node', payload: { topic: 'x' } }]
    expect(buildBatchReviewPayload(candidates)).toEqual({ type: 'candidate-batch-review', candidates })
  })
})

describe('resolveDecision：安全默认值', () => {
  it('用户明确给出的决策会被使用', () => {
    const decision = resolveDecision({ c1: { action: 'accept' } }, 'c1')
    expect(decision).toEqual({ action: 'accept' })
  })

  it('前端没覆盖到的候选（比如用户没点它就关闭了面板）默认按"忽略"处理，而不是默认接受——这是故意的安全默认值，不是遗漏', () => {
    const decision = resolveDecision({}, 'c-missing')
    expect(decision).toEqual({ action: 'reject' })
  })
})
