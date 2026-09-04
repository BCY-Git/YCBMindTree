import { describe, expect, it } from 'vitest'
import { createWorkflowGraph } from '../src/workflow-graph.js'

describe('createWorkflowGraph：循环边', () => {
  it('validation 判定"还不清楚"时会打回 modeling，而不是直接往前走', async () => {
    let calls = 0
    // 第一次判定"还不清楚"（触发循环边回 modeling），第二次判定"清楚了"（放行到 criteria）。
    const graph = createWorkflowGraph({
      checkValidation: async () => {
        calls += 1
        return calls === 1
      },
    })

    const result = await graph.invoke({ mode: 'explore', phase: 'context', checkpoints: [], needsReModeling: false })

    expect(calls).toBe(2) // 真的路由回 modeling 重新跑了一遍，不是只跑一次就完事
    expect(result.phase).toBe('criteria')
    expect(result.needsReModeling).toBe(false)
  })

  it('validation 一次就通过时，不会多绕一圈', async () => {
    let calls = 0
    const graph = createWorkflowGraph({ checkValidation: async () => { calls += 1; return false } })

    const result = await graph.invoke({ mode: 'decide', phase: 'context', checkpoints: [], needsReModeling: false })

    expect(calls).toBe(1)
    expect(result.phase).toBe('criteria')
  })
})
