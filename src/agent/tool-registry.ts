import { z } from 'zod'
import { defaultMaxObservationChars, truncateObservation } from '@/agent/context'
import { evaluateToolPermission } from '@/agent/permissions'
import type { AgentTool, AgentToolCall, ToolContext, ToolExecution } from '@/agent/types'

export function toFunctionCallingParams(tools: AgentTool[]) {
  return tools.map((tool) => ({//这里的map是用来将工具转换为Function Calling的参数
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema),
    },
  }))
}


export class ToolRegistry {//工具注册表
    private readonly tools = new Map<string, AgentTool>()

    register(tool: AgentTool): this {
      if (this.tools.has(tool.name)) throw new Error(`工具 ${tool.name} 已注册`)
      this.tools.set(tool.name, tool)
      return this
    }

    get(name: string): AgentTool | undefined {
      return this.tools.get(name)
    }

    list(): AgentTool[] {
      return [...this.tools.values()]
    }
  }


  export function createToolRegistry(tools: AgentTool[]): ToolRegistry {
    const registry = new ToolRegistry()
    for (const tool of tools) registry.register(tool)
    return registry
  }

  /**
 * 执行一次 Tool Call 的唯一入口：
 * 权限 → JSON 解析 → Schema 校验 → 运行 → 序列化 → 截断。
 */
export async function executeToolCall(
    registry: ToolRegistry,
    call: AgentToolCall,
    context: ToolContext = {},
    maxObservationChars = defaultMaxObservationChars,
  ): Promise<ToolExecution> {
    const startedAt = Date.now()

    const finish = (status: ToolExecution['status'], output: string): ToolExecution => ({
      call,
      status,
      output,
      durationMs: Date.now() - startedAt,
    })

    const tool = registry.get(call.name)
    const permission = evaluateToolPermission(tool)
    if (!permission.allowed || !tool) {
      return finish('denied', permission.reason ?? '工具不可用')
    }

    let rawArgs: unknown
    try {
      rawArgs = JSON.parse(call.arguments || '{}')
    } catch {
      return finish('error', '工具参数不是合法 JSON')
    }

    const parsed = tool.schema.safeParse(rawArgs)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(根)'}: ${issue.message}`)
        .join('；')
      return finish('error', `工具参数不符合要求：${issues}`)
    }

    try {
      const result = await tool.run(parsed.data, context)
      const serialized = typeof result === 'string' ? result : JSON.stringify(result)
      const observation = serialized ?? String(result)
      return finish('ok', truncateObservation(observation, maxObservationChars))
    } catch (error) {
      return finish('error', `工具执行失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }