import { executeToolCall, ToolRegistry } from './tool-registry'
import type { AgentEvent, AgentMessage, AgentRunResult, ModelClient } from './types'

export const defaultMaxSteps = 8

export interface AgentLoopOptions {
  model: ModelClient
  registry: ToolRegistry
  /** 初始消息；循环内部追加新消息，不回写调用方数组。 */
  messages: AgentMessage[]
  maxSteps?: number
  maxObservationChars?: number
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentRunResult> {
    const { model, registry } = options
    const maxSteps = options.maxSteps ?? defaultMaxSteps
    const messages: AgentMessage[] = [...options.messages]
    const tools = registry.list()
    const emit = (event: AgentEvent) => options.onEvent?.(event)

    for (let step = 1; step <= maxSteps; step += 1) {
      if (options.signal?.aborted) {
        return {//如果信号被中止，返回中止结果
          status: 'aborted',
          finalContent: '',
          steps: step - 1,
          messages,
        }
      }

      emit({ type: 'step-start', step })//发出步骤开始事件

      let response
      try {
        response = await model.chat(messages, tools, options.signal)//调用模型完成
      } catch (error) {
        return {//如果模型完成失败，返回失败结果
          status: 'failed',
          finalContent: error instanceof Error ? error.message : String(error),
          steps: step,
          messages,
        }
      }

      if (!response.toolCalls.length) {
        messages.push({//如果模型没有工具调用，添加助手消息
          role: 'assistant',
          content: response.content,
        })

        emit({//发出最终事件
          type: 'final',
          step,
          content: response.content,
        })

        return {//返回完成结果
          status: 'completed',
          finalContent: response.content,
          steps: step,
          messages,
        }
      }

      messages.push({//如果模型有工具调用，添加助手消息
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      })

      for (const call of response.toolCalls) {
        // 先发出调用意图，便于 UI 给出可解释的实时轨迹，而不是只在结果回来后静默更新。
        emit({ type: 'tool-call', step, call })
        const execution = await executeToolCall(registry, call, { signal: options.signal }, options.maxObservationChars)//执行工具调用

        emit({ type: 'tool-result', step, execution })//发出工具结果事件

        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: execution.output,
        })
      }
    }

    emit({ type: 'budget-exceeded', step: maxSteps })

    return {
      status: 'budget-exceeded',
      finalContent: '',
      steps: maxSteps,
      messages,
    }
  }
