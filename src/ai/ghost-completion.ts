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
  // 某些模型会完整重复输入，也可能在前面加一句很短的引导；取最后一次前缀后的增量。
  const prefixPosition = trimmed.lastIndexOf(prefix)
  const withoutRepeatedPrefix = prefixPosition >= 0 ? trimmed.slice(prefixPosition + prefix.length).replace(/^\s+/, '') : trimmed
  return withoutRepeatedPrefix.slice(0, 240)
}

export function buildGhostCompletionRequest(settings: AiSettings, document: MindMapDocument, nodeId: string, prefix: string, maxTokens = 72) {
  const node = document.nodes[nodeId]
  if (!node) throw new Error('节点不存在')
  const siblings = node.parentId ? document.nodes[node.parentId].childIds
    .filter((id) => id !== nodeId).slice(0, 4).map((id) => document.nodes[id].topic) : []
  return {
    endpoint: completionUrl(settings.endpoint),
    request: {
      model: settings.model.trim(),
      messages: [
        { role: 'system', content: '你是 MindTree 的中文笔记续写引擎。仅补全当前备注后续最自然、具体的一小段内容；不要重复已有文字，不要解释，不要使用 Markdown 标题。' },
        { role: 'user', content: `当前节点路径：${nodePath(document, nodeId)}\n同级主题：${siblings.join('、') || '无'}\n当前已输入：${prefix}\n只输出应该紧跟在上述文字后的续写，不要重复“当前已输入”的内容。` },
      ],
      temperature: 0.25,
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
    },
  }
}

export async function requestGhostCompletion(settings: AiSettings, document: MindMapDocument, nodeId: string, prefix: string, signal: AbortSignal, maxTokens = 72) {
  const ghostRequest = buildGhostCompletionRequest(settings, document, nodeId, prefix, maxTokens)
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey.trim()}` },
    body: JSON.stringify({
      endpoint: ghostRequest.endpoint,
      request: ghostRequest.request,
    }),
  })
  const payload = await response.json().catch(() => ({})) as CompletionResponse
  if (!response.ok) throw new Error(payload.error?.message || `续写请求失败（${response.status}）`)
  return normalizeCompletion(prefix, payload.choices?.[0]?.message?.content ?? '')
}
