import type { AgentMessage, AgentTool, ModelClient, ModelResponse } from '@/agent/types'

export interface ScriptedToolCall {
  name: string
  arguments?: unknown
}

export interface ScriptedReply {
  content?: string
  toolCalls?: ScriptedToolCall[]
}

/**
 * 测试用假模型：按脚本依次返回预定回复，不访问网络，
 * loop 测试因此完全确定。脚本耗尽后返回占位文本使循环自然结束。
 */
export class ScriptedModelClient implements ModelClient {
  /** 每次 chat 收到的消息快照，供断言「模型看到了什么」。 */
  readonly calls: AgentMessage[][] = []
  private replyIndex = 0

  constructor(private readonly replies: ScriptedReply[]) {}

  async chat(messages: AgentMessage[], _tools: AgentTool[]): Promise<ModelResponse> {
    this.calls.push(messages.map((message) => ({ ...message })))
    const reply = this.replies[this.replyIndex] ?? { content: '（脚本回复已耗尽）' }
    this.replyIndex += 1
    return {
      content: reply.content ?? '',
      toolCalls: (reply.toolCalls ?? []).map((call, index) => ({
        id: `scripted-${this.replyIndex}-${index}`,
        name: call.name,
        arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
      })),
    }
  }
}
