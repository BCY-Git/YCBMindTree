import { describe, expect, it } from 'vitest'
import { MemorySaver, Command } from '@langchain/langgraph'
import { AIMessageChunk, HumanMessage } from '@langchain/core/messages'
import { FakeStreamingChatModel } from '@langchain/core/utils/testing'
import { createMindTreeGraph } from '../src/graph.js'
import { proposeCreateNode } from '../src/tools.js'
import type { CandidateProposal } from '../src/state.js'
import type { BatchApprovalDecisions } from '../src/approval.js'

/**
 * 这几个测试是整个包里最重要的一份——验证"候选制"这条产品红线在图结构层面
 * 是不是真的守住了：模型想生成什么都行，但只有 interrupt() 恢复之后、
 * 决策是 accept 的那部分，才会真的调用 applyCandidate。
 *
 * 用 FakeStreamingChatModel 而不是真实模型：LangGraph 官方测试工具里，
 * 非流式 invoke() 走 _generate()，tool_calls 只认 `chunks[0].tool_calls`
 * （content 才认 responses[0]），这是踩坑之后才搞清楚的，注释留着方便你
 * 以后照着抄，不用重新踩一遍。
 */
function fakeModelWithToolCall(name: string, args: Record<string, unknown>, id = 'call_1') {
  return new FakeStreamingChatModel({
    chunks: [new AIMessageChunk({ content: '', tool_calls: [{ name, args, id }] })],
  })
}

/**
 * `graph.invoke()` 在暂停时，运行期返回值里真的会带一个 `__interrupt__` 字段
 * （形状是 `[{ id, value }]`，用一段最小复现脚本验证过），但 langgraph.js 当前
 * 版本的 TS 类型声明里没有把它写进 `invoke()` 的返回类型——这是库的类型声明
 * 缺口，不是我们代码的问题。与其在每处用 `as any` 掩盖，不如把这个"类型声明
 * 和运行时行为对不上"的事实收敛到一个具名的类型 + 一个读取函数里，
 * 其余地方都是强类型的。
 */
type InterruptEnvelope = { __interrupt__?: Array<{ id: string; value: unknown }> }
function readInterruptValue<T>(result: unknown): T {
  const interrupts = (result as InterruptEnvelope).__interrupt__
  if (!interrupts?.length) throw new Error('期望图已经暂停在 interrupt()，但 __interrupt__ 为空')
  return interrupts[0]!.value as T
}
function hasInterrupted(result: unknown): boolean {
  return Boolean((result as InterruptEnvelope).__interrupt__?.length)
}

describe('createMindTreeGraph：批量 interrupt 审批', () => {
  it('模型没有生成任何候选时，直接跑完，不触发 interrupt，也不调用 applyCandidate', async () => {
    const applied: CandidateProposal[] = []
    const model = new FakeStreamingChatModel({ chunks: [new AIMessageChunk({ content: '好的' })] })
    const graph = createMindTreeGraph({
      model,
      tools: [proposeCreateNode],
      checkpointer: new MemorySaver(),
      applyCandidate: async (c) => { applied.push(c) },
    })

    const result = await graph.invoke(
      { messages: [new HumanMessage('随便聊聊')] },
      { configurable: { thread_id: 'thread-empty' } },
    )

    expect(hasInterrupted(result)).toBe(false)
    expect(applied).toEqual([])
  })

  it('用户 accept：候选被写入；先验证 interrupt payload 带够了字段', async () => {
    const applied: CandidateProposal[] = []
    const model = fakeModelWithToolCall('propose_create_node', { parentId: 'n1', topic: '新分支', taskStatus: 'todo' })
    const graph = createMindTreeGraph({
      model,
      tools: [proposeCreateNode],
      checkpointer: new MemorySaver(),
      applyCandidate: async (c) => { applied.push(c) },
    })
    const config = { configurable: { thread_id: 'thread-accept' } }

    const paused = await graph.invoke({ messages: [new HumanMessage('帮我扩展一下')] }, config)

    // 图确实在这一步物理暂停了，而不是"业务代码假装暂停"。
    expect(hasInterrupted(paused)).toBe(true)
    const interruptPayload = readInterruptValue<{ type: string; candidates: CandidateProposal[] }>(paused)
    expect(interruptPayload.type).toBe('candidate-batch-review')
    expect(interruptPayload.candidates).toHaveLength(1)
    expect(interruptPayload.candidates[0]?.toolName).toBe('propose_create_node')
    expect(interruptPayload.candidates[0]?.payload).toEqual({ parentId: 'n1', topic: '新分支', taskStatus: 'todo' })

    const candidateId = interruptPayload.candidates[0]!.id
    const decisions: BatchApprovalDecisions = { [candidateId]: { action: 'accept' } }
    const finalState = await graph.invoke(new Command({ resume: decisions }), config)

    expect(hasInterrupted(finalState)).toBe(false)
    expect(applied).toHaveLength(1)
    expect(applied[0]?.toolName).toBe('propose_create_node')
    expect(finalState.pendingCandidates).toEqual([]) // 审完之后清空，不会一直挂着
  })

  it('用户 reject：候选不会被写入', async () => {
    const applied: CandidateProposal[] = []
    const model = fakeModelWithToolCall('propose_create_node', { parentId: 'n1', topic: '不需要的分支' })
    const graph = createMindTreeGraph({
      model,
      tools: [proposeCreateNode],
      checkpointer: new MemorySaver(),
      applyCandidate: async (c) => { applied.push(c) },
    })
    const config = { configurable: { thread_id: 'thread-reject' } }

    const paused = await graph.invoke({ messages: [new HumanMessage('帮我扩展一下')] }, config)
    const candidateId = readInterruptValue<{ candidates: CandidateProposal[] }>(paused).candidates[0]!.id

    await graph.invoke(new Command({ resume: { [candidateId]: { action: 'reject' } } as BatchApprovalDecisions }), config)

    expect(applied).toEqual([]) // 关键断言：拒绝的候选绝不会调用 applyCandidate
  })

  it('用户没有对某个候选表态：默认按 reject 处理，不会被意外写入', async () => {
    const applied: CandidateProposal[] = []
    const model = fakeModelWithToolCall('propose_create_node', { parentId: 'n1', topic: '悬而未决' })
    const graph = createMindTreeGraph({
      model,
      tools: [proposeCreateNode],
      checkpointer: new MemorySaver(),
      applyCandidate: async (c) => { applied.push(c) },
    })
    const config = { configurable: { thread_id: 'thread-missing-decision' } }

    await graph.invoke({ messages: [new HumanMessage('帮我扩展一下')] }, config)
    // 前端异常关闭、什么决策都没传回来的情况——空对象。
    await graph.invoke(new Command({ resume: {} as BatchApprovalDecisions }), config)

    expect(applied).toEqual([])
  })
})
