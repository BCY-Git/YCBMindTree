import type { AiSettings } from './ai-settings'
import { chatUrl } from './ai-settings'
import type { MindMapDocument } from '../domain/document.types'
import { requestAiChat } from '../platform/tauri'

type ChatResponse = { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }

function withoutCodeFence(content: string) {
  return content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

/** 把模型输出收敛成恰好三个简短、去重的直接子节点。 */
export function parseExpandedIdeas(content: string): string[] {
  const parsed = JSON.parse(withoutCodeFence(content)) as unknown
  const candidates = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && 'ideas' in parsed
      ? (parsed as { ideas: unknown }).ideas
      : null
  if (!Array.isArray(candidates)) throw new Error('AI 返回的想法格式无效')
  const ideas = [...new Set(candidates
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().replace(/^[-*\d.、)）\s]+/, '').slice(0, 80))
    .filter(Boolean))]
  if (ideas.length < 3) throw new Error('AI 没有返回 3 个有效想法')
  return ideas.slice(0, 3)
}

function nodeContext(document: MindMapDocument, nodeId: string) {
  const node = document.nodes[nodeId]
  if (!node) throw new Error('当前节点已不存在')
  const ancestors: string[] = []
  let current = node.parentId ? document.nodes[node.parentId] : null
  while (current) {
    ancestors.unshift(current.topic)
    current = current.parentId ? document.nodes[current.parentId] : null
  }
  return {
    mapTitle: document.title,
    path: [...ancestors, node.topic],
    topic: node.topic,
    note: node.note.slice(0, 800),
    existingChildren: node.childIds.map((id) => document.nodes[id]?.topic).filter(Boolean),
  }
}

export async function requestExpandedIdeas(
  settings: AiSettings,
  document: MindMapDocument,
  nodeId: string,
  signal?: AbortSignal,
) {
  const response = await requestAiChat(chatUrl(settings.endpoint), {
    model: settings.model.trim(),
    temperature: 0.55,
    messages: [
      {
        role: 'system',
        content: '你是 MindTree 的节点扩展助手。分析当前节点，只提出 3 个最直接、互不重复、与已有子节点不重复的下一层主题。每项使用简洁中文短语，不要解释，不要继续嵌套。只返回合法 JSON：{"ideas":["想法1","想法2","想法3"]}',
      },
      { role: 'user', content: JSON.stringify(nodeContext(document, nodeId)) },
    ],
  }, settings.apiKey, signal)
  const payload = await response.json().catch(() => ({})) as ChatResponse
  if (!response.ok) throw new Error(payload.error?.message || `AI 请求失败（${response.status}）`)
  const content = payload.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('AI 没有返回内容')
  return parseExpandedIdeas(content)
}
