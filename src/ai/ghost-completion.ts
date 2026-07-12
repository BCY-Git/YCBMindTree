import type { MindMapDocument, MindNode } from '../domain/document.types'
import { completionUrl, type AiSettings } from './ai-settings'

type CompletionResponse = { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }

function nodePath(document: MindMapDocument, nodeId: string) {
  const path: string[] = []
  let current: MindNode | undefined = document.nodes[nodeId]
  while (current) {
    path.unshift(current.topic)
    current = current.parentId ? document.nodes[current.parentId] : undefined
  }
  return path.join(' / ')
}

export function normalizeCompletion(prefix: string, completion: string) {
  const trimmed = completion.replace(/^\s+/, '')
  if (!trimmed) return ''
  const withoutRepeatedPrefix = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed
  return withoutRepeatedPrefix.slice(0, 240)
}

export async function requestGhostCompletion(settings: AiSettings, document: MindMapDocument, nodeId: string, prefix: string, signal: AbortSignal, maxTokens = 72) {
  const node = document.nodes[nodeId]
  if (!node) return ''
  const siblings = node.parentId ? document.nodes[node.parentId].childIds
    .filter((id) => id !== nodeId).slice(0, 4).map((id) => document.nodes[id].topic) : []
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey.trim()}` },
    body: JSON.stringify({
      endpoint: completionUrl(settings.endpoint),
      request: {
        model: settings.model.trim(),
        messages: [
          { role: 'system', content: '你是 MindTree 的中文笔记续写引擎。仅补全当前备注后续最自然、具体的一小段内容；不要重复已有文字，不要解释，不要使用 Markdown 标题。' },
          { role: 'user', content: `当前节点路径：${nodePath(document, nodeId)}\n同级主题：${siblings.join('、') || '无'}\n请续写下方备注：` },
          { role: 'assistant', content: prefix, prefix: true },
        ],
        temperature: 0.25,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
      },
    }),
  })
  const payload = await response.json().catch(() => ({})) as CompletionResponse
  if (!response.ok) throw new Error(payload.error?.message || `续写请求失败（${response.status}）`)
  return normalizeCompletion(prefix, payload.choices?.[0]?.message?.content ?? '')
}
