import { runAgentLoop } from '@/agent/loop'
import { createToolRegistry } from '@/agent/tool-registry'
import { AgentTracer } from '@/agent/trace'
import { echoTool } from '@/agent/echo'
import { ScriptedModelClient } from '@/tests/agent/scripted-model'
import type { AgentEvent } from '@/agent/types'

const registry = () => createToolRegistry([echoTool])
const start = [{ role: 'user' as const, content: '开始整理' }]

describe('runAgentLoop', () => {
  it('模型直接回复时一轮完成', async () => {
    const model = new ScriptedModelClient([{ content: '整理完成' }])
    const result = await runAgentLoop({ model, registry: registry(), messages: start })
    expect(result.status).toBe('completed')
    expect(result.steps).toBe(1)
    expect(result.finalContent).toBe('整理完成')
    expect(result.messages.at(-1)).toMatchObject({ role: 'assistant', content: '整理完成' })
  })

  it('执行工具调用后把观察还给模型，直到最终回复', async () => {
    const model = new ScriptedModelClient([
      { toolCalls: [{ name: 'echo', arguments: { text: '你好' } }] },
      { content: '已读取材料' },
    ])
    const events: AgentEvent[] = []
    const result = await runAgentLoop({ model, registry: registry(), messages: start, onEvent: (event) => events.push(event) })

    expect(result.status).toBe('completed')
    expect(result.steps).toBe(2)
    const toolMessage = result.messages.find((message) => message.role === 'tool')
    expect(toolMessage?.content).toContain('你好')
    expect(toolMessage?.toolCallId).toBe('scripted-1-0')
    // 第二步的模型必须能看到第一步的工具观察
    expect(model.calls[1].some((message) => message.role === 'tool' && message.content.includes('你好'))).toBe(true)
    expect(events.map((event) => event.type)).toEqual(['step-start', 'tool-call', 'tool-result', 'step-start', 'final'])
  })

  it('模型持续要求工具时触发步数预算', async () => {
    const model = new ScriptedModelClient(
      Array.from({ length: 3 }, () => ({ toolCalls: [{ name: 'echo', arguments: { text: 'x' } }] })),
    )
    const result = await runAgentLoop({ model, registry: registry(), messages: start, maxSteps: 2 })
    expect(result.status).toBe('budget-exceeded')
    expect(result.steps).toBe(2)
  })

  it('中断信号在循环开始前生效，模型不被调用', async () => {
    const controller = new AbortController()
    controller.abort()
    const model = new ScriptedModelClient([{ content: '不应到达' }])
    const result = await runAgentLoop({ model, registry: registry(), messages: start, signal: controller.signal })
    expect(result.status).toBe('aborted')
    expect(model.calls).toHaveLength(0)
  })

  it('模型请求未注册工具时收到拒绝观察，循环继续', async () => {
    const model = new ScriptedModelClient([
      { toolCalls: [{ name: 'delete-everything' }] },
      { content: '明白，无法执行该操作' },
    ])
    const result = await runAgentLoop({ model, registry: registry(), messages: start })
    expect(result.status).toBe('completed')
    const toolMessage = result.messages.find((message) => message.role === 'tool')
    expect(toolMessage?.content).toContain('未注册')
  })

  it('模型抛错时以 failed 收尾而不抛出异常', async () => {
    const broken = { chat: async () => { throw new Error('网络超时') } }
    const result = await runAgentLoop({ model: broken, registry: registry(), messages: start })
    expect(result.status).toBe('failed')
    expect(result.finalContent).toBe('网络超时')
  })

  it('AgentTracer 收集完整中文轨迹', async () => {
    const model = new ScriptedModelClient([
      { toolCalls: [{ name: 'echo', arguments: { text: '材料' } }] },
      { content: '整理完成' },
    ])
    const tracer = new AgentTracer()
    await runAgentLoop({ model, registry: registry(), messages: start, onEvent: tracer.handle })
    const summaries = tracer.entries.map((entry) => entry.summary)
    expect(summaries[0]).toContain('第 1 步')
    expect(summaries[1]).toContain('调用工具 echo')
    expect(summaries[2]).toContain('echo 完成')
    expect(summaries.at(-1)).toContain('完成：整理完成')
  })
})
