import type { ZodType } from 'zod'

type AgentRole = 'system' | 'user' | 'assistant' | 'tool'//一次Agent运行至少会出现四种消息


//这个就是agent的调用工具的参数
export interface AgentToolCall {
  id: string//关联后续Tool Message
  name: string//在注册表中查找具体工具
  arguments: string//模型输出的原始JSON字符串
}

//agent调用工具的时候需要的一些参数
export interface AgentMessage {
  role: AgentRole
  content: string
  toolCalls?: AgentToolCall[]//工具调用
  toolCallId?: string//关联Tool Message
}

export type ToolCategory = 'read' | 'proposal'//工具类别:读取数据,提出方案

export interface ToolContext {
  signal?: AbortSignal//可选的AbortSignal，用于终止工具执行
}

export interface AgentTool<A = unknown> {
  readonly name: string//工具名称
  readonly description: string//工具描述
  readonly category: ToolCategory//工具类别
  readonly schema: ZodType<A>//工具参数类型
  run(args: A, context: ToolContext): Promise<unknown>//工具执行
}

/** 一次工具执行的标准结果状态。 */
export type ToolExecutionStatus = 'ok' | 'denied' | 'error'//工具执行状态

/** 工具注册表执行一次 Tool Call 后返回的统一结果。 */
export interface ToolExecution {
  call: AgentToolCall
  status: ToolExecutionStatus
  /** 回填给模型的观察文本；成功结果应已序列化并截断。 */
  output: string
  durationMs: number
}


/** Agent 运行过程中的结构化事件。 */
export type AgentEvent =
  | { type: 'step-start'; step: number }
  | { type: 'tool-call'; step: number; call: AgentToolCall }
  | { type: 'tool-result'; step: number; execution: ToolExecution }
  | { type: 'final'; step: number; content: string }
  | { type: 'budget-exceeded'; step: number }

/** 一次 Agent 运行的最终状态。 */
export type AgentRunStatus = 'completed' | 'budget-exceeded' | 'aborted' | 'failed'

/** Agent Loop 结束后返回给业务层的完整结果。 */
export interface AgentRunResult {
  status: AgentRunStatus
  /** completed 时是最终回答，failed 时是错误信息，其余状态为空字符串。 */
  finalContent: string
  steps: number
  messages: AgentMessage[]
}

/** 模型客户端归一化后的响应。 */
export interface ModelResponse {
  content: string
  toolCalls: AgentToolCall[]
}

/** Harness 依赖的最小模型接口。 */
export interface ModelClient {
  chat(messages: AgentMessage[], tools: AgentTool[], signal?: AbortSignal): Promise<ModelResponse>
}
