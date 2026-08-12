import { requestAiChat } from '../platform/tauri'
import { toFunctionCallingParams } from './tool-registry'
import type { AgentMessage, AgentTool, AgentToolCall, ModelClient, ModelResponse } from './types'

/**
 * 文本降级协议：端点不支持原生 Function Calling 时，
 * 模型在 Content 中输出 {"action":"工具名","input":{...}}。
 */
export function parseTextProtocolAction(content: string): { name: string; input: unknown } | null {
    const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    if (!text.startsWith('{')) return null

    try {
      const parsed = JSON.parse(text) as { action?: unknown; input?: unknown }
      if (typeof parsed.action !== 'string' || !parsed.action.trim()) return null
      return { name: parsed.action.trim(), input: parsed.input ?? {} }
    } catch {
      return null
    }
  }

  type WireMessage = {//模型客户端归一化后的响应
    role: string
    content: string
    tool_calls?: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }>
    tool_call_id?: string
  }

  function toWireMessage(message: AgentMessage): WireMessage {//将AgentMessage转换为模型客户端归一化后的响应
    const wire: WireMessage = {
      role: message.role,
      content: message.content,
    }

    if (message.toolCalls?.length) {
      wire.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: {
          name: call.name,
          arguments: call.arguments,
        },
      }))
    }

    if (message.toolCallId) wire.tool_call_id = message.toolCallId
    return wire
  }



  let textActionCounter = 0

  /** 把兼容端点的模型消息归一化成 Harness 内部 ModelResponse。 */
  export function normalizeModelMessage(message: unknown): ModelResponse {
    const raw = (message ?? {}) as { content?: unknown; tool_calls?: unknown }
    const content = typeof raw.content === 'string' ? raw.content : ''

    const toolCalls: AgentToolCall[] = Array.isArray(raw.tool_calls)
      ? raw.tool_calls.flatMap((item, index) => {
          const call = item as {
            id?: unknown
            function?: { name?: unknown; arguments?: unknown }
          }

          const name = typeof call.function?.name === 'string' ? call.function.name.trim() : ''
          if (!name) return []

          return [
            {
              id: typeof call.id === 'string' && call.id ? call.id : `call-${index}`,
              name,
              arguments:
                typeof call.function?.arguments === 'string'
                  ? call.function.arguments
                  : JSON.stringify(call.function?.arguments ?? {}),
            },
          ]
        })
      : []

    if (toolCalls.length) return { content, toolCalls }

    const action = parseTextProtocolAction(content)
    if (action) {
      textActionCounter += 1
      return {
        content: '',
        toolCalls: [
          {
            id: `text-action-${textActionCounter}`,
            name: action.name,
            arguments: JSON.stringify(action.input),
          },
        ],
      }
    }

    return { content, toolCalls: [] }
  }




  export interface OpenAiModelClientOptions {
  /** 完整 Chat Completions 地址。 */
  endpoint: string
  model: string
  apiKey: string
  temperature?: number
}

/** 通过 MindTree 统一网络出口访问 OpenAI 兼容端点。 */
export class OpenAiModelClient implements ModelClient {
  constructor(private readonly options: OpenAiModelClientOptions) {}

  async chat(
    messages: AgentMessage[],
    tools: AgentTool[],
    signal?: AbortSignal,
  ): Promise<ModelResponse> {
    const request: Record<string, unknown> = {
      model: this.options.model,
      temperature: this.options.temperature ?? 0.3,
      messages: messages.map(toWireMessage),
    }

    if (tools.length) request.tools = toFunctionCallingParams(tools)

    const response = await requestAiChat(
      this.options.endpoint,
      request,
      this.options.apiKey,
      signal,
    )

    const payload = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: unknown }>
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new Error(payload.error?.message || `模型请求失败（${response.status}）`)
    }

    const message = payload.choices?.[0]?.message
    if (message === undefined) throw new Error('模型没有返回内容。')
    return normalizeModelMessage(message)
  }
}