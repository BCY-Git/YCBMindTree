import { normalizeModelMessage, parseTextProtocolAction } from '@/agent/model-client'

describe('parseTextProtocolAction', () => {
  it('解析标准 JSON 动作', () => {
    expect(parseTextProtocolAction('{"action":"web-fetch","input":{"url":"https://a.com"}}')).toEqual({
      name: 'web-fetch',
      input: { url: 'https://a.com' },
    })
  })

  it('容忍代码围栏包裹', () => {
    expect(parseTextProtocolAction('```json\n{"action":"echo","input":{"text":"hi"}}\n```')?.name).toBe('echo')
  })

  it('普通文本与缺 action 的 JSON 都返回 null', () => {
    expect(parseTextProtocolAction('这是最终回复')).toBeNull()
    expect(parseTextProtocolAction('{"summary":"不是动作"}')).toBeNull()
  })
})

describe('normalizeModelMessage', () => {
  it('原生 tool_calls 优先，且容忍 arguments 为对象', () => {
    const result = normalizeModelMessage({
      content: '{"action":"echo","input":{}}',
      tool_calls: [{ id: 'call_1', function: { name: 'echo', arguments: { text: 'hi' } } }],
    })
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]).toMatchObject({ id: 'call_1', name: 'echo', arguments: '{"text":"hi"}' })
  })

  it('无原生调用时降级解析文本协议', () => {
    const result = normalizeModelMessage({ content: '{"action":"echo","input":{"text":"hi"}}' })
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('echo')
    expect(JSON.parse(result.toolCalls[0].arguments)).toEqual({ text: 'hi' })
  })

  it('普通回复作为最终内容返回', () => {
    const result = normalizeModelMessage({ content: '整理完成' })
    expect(result.toolCalls).toHaveLength(0)
    expect(result.content).toBe('整理完成')
  })

  it('过滤掉没有工具名的调用项', () => {
    const result = normalizeModelMessage({ tool_calls: [{ id: 'x', function: {} }] })
    expect(result.toolCalls).toHaveLength(0)
  })
})
