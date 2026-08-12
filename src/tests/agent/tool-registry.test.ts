import { createToolRegistry, executeToolCall, toFunctionCallingParams, ToolRegistry } from '@/agent/tool-registry'
import { echoTool } from '@/agent/echo'

describe('ToolRegistry', () => {
  it('重复注册同名工具时抛错', () => {
    const registry = new ToolRegistry()
    registry.register(echoTool)
    expect(() => registry.register(echoTool)).toThrow('echo')
  })

  it('toFunctionCallingParams 输出 OpenAI function calling 结构', () => {
    const [param] = toFunctionCallingParams([echoTool])
    expect(param.type).toBe('function')
    expect(param.function.name).toBe('echo')
    expect(param.function.description).toContain('回显')
    expect(param.function.parameters).toMatchObject({ type: 'object', properties: { text: { type: 'string' } } })
  })
})

describe('executeToolCall', () => {
  const registry = () => createToolRegistry([echoTool])

  it('正常执行返回 JSON 观察', async () => {
    const execution = await executeToolCall(registry(), { id: 'c1', name: 'echo', arguments: '{"text":"你好"}' })
    expect(execution.status).toBe('ok')
    expect(JSON.parse(execution.output)).toEqual({ echo: '你好' })
    expect(execution.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('参数不是合法 JSON 时返回错误观察', async () => {
    const execution = await executeToolCall(registry(), { id: 'c2', name: 'echo', arguments: '{oops' })
    expect(execution.status).toBe('error')
    expect(execution.output).toContain('JSON')
  })

  it('参数不符合 schema 时返回校验详情', async () => {
    const execution = await executeToolCall(registry(), { id: 'c3', name: 'echo', arguments: '{"text":""}' })
    expect(execution.status).toBe('error')
    expect(execution.output).toContain('text')
  })

  it('未注册工具被拒绝', async () => {
    const execution = await executeToolCall(registry(), { id: 'c4', name: 'rm-rf', arguments: '{}' })
    expect(execution.status).toBe('denied')
    expect(execution.output).toContain('未注册')
  })

  it('超长输出按预算截断并附加标记', async () => {
    const execution = await executeToolCall(registry(), { id: 'c5', name: 'echo', arguments: '{"text":"1234567890"}' }, {}, 10)
    expect(execution.status).toBe('ok')
    expect(execution.output.length).toBeLessThan(40)
    expect(execution.output).toContain('已截断')
  })
})
