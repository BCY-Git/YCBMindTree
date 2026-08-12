import type { AgentEvent } from './types'

export interface TraceEntry {//追踪条目
  step: number
  kind: AgentEvent['type']
  /** 给用户看的一行中文摘要，例如“调用工具 web-fetch”。 */
  summary: string
  at: number
}

export class AgentTracer {//追踪器
  readonly entries: TraceEntry[] = []

  readonly handle = (event: AgentEvent) => {//处理事件
    this.entries.push({
      step: event.step,
      kind: event.type,
      summary: summarizeEvent(event),
      at: Date.now(),
    })
  }
}

function summarizeEvent(event: AgentEvent): string {//总结事件
    switch (event.type) {
      case 'step-start':
        return `第 ${event.step} 步：等待模型决策`//等待模型决策

      case 'tool-call':
        return `调用工具 ${event.call.name}`//调用工具

      case 'tool-result': {
        const { execution } = event//执行结果
        if (execution.status === 'ok') {
          return `${execution.call.name} 完成（${execution.durationMs}ms，${execution.output.length} 字）`//完成
        }
        if (execution.status === 'denied') {
          return `${execution.call.name} 被拒绝：${execution.output}`
        }

        return `${execution.call.name} 出错：${execution.output}`
      }

      case 'final':
        return event.content.length > 80
          ? `完成：${event.content.slice(0, 80)}…`
          : `完成：${event.content}`

      case 'budget-exceeded':
        return '达到步数上限，停止循环'
    }
  }