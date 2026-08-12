import { estimateTokens, pruneMessages, truncateObservation } from '@/agent/context'
import type { AgentMessage } from '@/agent/types'

describe('truncateObservation', () => {
  it('未超限时原样返回', () => {
    expect(truncateObservation('短文本', 100)).toBe('短文本')
  })

  it('超限时截断并附加标记', () => {
    const result = truncateObservation('x'.repeat(100), 10)
    expect(result.startsWith('x'.repeat(10))).toBe(true)
    expect(result).toContain('已截断')
  })
})

describe('estimateTokens', () => {
  it('按约 4 字符 1 token 估算，含工具参数', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'x'.repeat(400) },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'echo', arguments: 'y'.repeat(40) }] },
    ]
    expect(estimateTokens(messages)).toBe(110)
  })
})

describe('pruneMessages', () => {
  it('未超窗口时原样返回', () => {
    const messages: AgentMessage[] = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]
    expect(pruneMessages(messages, 10)).toEqual(messages)
  })

  it('保留 system 消息并裁剪到窗口内', () => {
    const messages: AgentMessage[] = [
      { role: 'system', content: 's' },
      ...Array.from({ length: 10 }, (_, i): AgentMessage => ({ role: 'user', content: `u${i}` })),
    ]
    const pruned = pruneMessages(messages, 5)
    expect(pruned.length).toBeLessThanOrEqual(5)
    expect(pruned[0]).toMatchObject({ role: 'system' })
    expect(pruned.at(-1)?.content).toBe('u9')
  })

  it('截断点不落在工具往返中间', () => {
    const messages: AgentMessage[] = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u0' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c1', content: '观察' },
      { role: 'assistant', content: '最终回复' },
    ]
    const pruned = pruneMessages(messages, 4)
    // 带 toolCalls 的 assistant 和孤立的 tool 消息都必须被丢弃；
    // 窗口只有 4，system 占 1，最旧的 user 消息也被裁掉
    expect(pruned.some((message) => message.role === 'tool')).toBe(false)
    expect(pruned.some((message) => message.toolCalls?.length)).toBe(false)
    expect(pruned.map((message) => message.role)).toEqual(['system', 'assistant'])
    expect(pruned[1].content).toBe('最终回复')
  })
})
