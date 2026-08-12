import type { AgentMessage } from '@/agent/types'

export const defaultMaxObservationChars = 8000//默认的观察结果的长度上限
export const defaultMaxMessages = 40//默认的消息窗口大小

const truncationMarker = '\n…[输出过长，已截断]'


/** 单个工具观察结果的长度上限，防止一次取材撑爆上下文。 */
export function truncateObservation(text: string, maxChars = defaultMaxObservationChars): string {
    if (text.length <= maxChars) return text
    return `${text.slice(0, maxChars)}${truncationMarker}`
}

/**
 * 粗略估算（约 4 字符 1 Token），只用于第一版预算控制。
 * 该估算对中文并不精确，不能作为生产计费依据。
 */
export function estimateTokens(messages: AgentMessage[]): number {
    const chars = messages.reduce(
        (sum, message) =>
            sum + message.content.length + (message.toolCalls ?? []).reduce((inner, call) => inner + call.arguments.length, 0),
        0,
    )
    return Math.ceil(chars / 4)
}

/**
* 消息窗口裁剪：保留全部 System Message 和最近的对话。
* 截断点不能落在一次工具往返中间。
*/
export function pruneMessages(messages: AgentMessage[], maxMessages = defaultMaxMessages): AgentMessage[] {
    if (messages.length <= maxMessages) return messages

    const system = messages.filter((message) => message.role === 'system')
    const rest = messages.filter((message) => message.role !== 'system')
    const tail = rest.slice(Math.max(0, rest.length - (maxMessages - system.length)))

    let start = 0
    while (
        start < tail.length &&
        (tail[start].role === 'tool' || (tail[start].role === 'assistant' && tail[start].toolCalls?.length))
    ) {
        start += 1
    }

    return [...system, ...tail.slice(start)]
}