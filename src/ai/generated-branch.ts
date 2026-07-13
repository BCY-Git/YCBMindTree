import type { MindNodeClipboard } from '../domain/commands'
import type { MindNodePriority, MindNodeTaskStatus } from '../domain/document.types'

const maxGeneratedNodes = 60
const maxTopicLength = 160

function parseTaskStatus(value: unknown): MindNodeTaskStatus {
  return value === 'todo' || value === 'doing' || value === 'done' ? value : 'none'
}

function parsePriority(value: unknown): MindNodePriority {
  return value === 1 || value === 2 || value === 3 ? value : 0
}

function parseDueDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : value
}

function withoutCodeFence(content: string) {
  return content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

export function parseGeneratedBranch(content: string): MindNodeClipboard {
  const parsed = JSON.parse(withoutCodeFence(content)) as unknown
  const candidate = typeof parsed === 'object' && parsed !== null && 'branch' in parsed
    ? (parsed as { branch: unknown }).branch
    : parsed
  let nodeCount = 0

  const parseNode = (value: unknown, depth: number): MindNodeClipboard => {
    if (depth > 6 || typeof value !== 'object' || value === null) throw new Error('AI 返回的分支层级或格式无效')
    const node = value as { topic?: unknown; children?: unknown; taskStatus?: unknown; priority?: unknown; dueDate?: unknown }
    if (typeof node.topic !== 'string' || !node.topic.trim()) throw new Error('AI 返回的节点缺少主题')
    nodeCount += 1
    if (nodeCount > maxGeneratedNodes) throw new Error(`一次最多插入 ${maxGeneratedNodes} 个 AI 节点`)
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error('AI 返回的子节点格式无效')
    return {
      topic: node.topic.trim().slice(0, maxTopicLength),
      note: '',
      links: [],
      attachments: [],
      taskStatus: parseTaskStatus(node.taskStatus),
      priority: parsePriority(node.priority),
      dueDate: parseDueDate(node.dueDate),
      collapsed: false,
      children: (node.children ?? []).map((child) => parseNode(child, depth + 1)),
    }
  }

  return parseNode(candidate, 0)
}

export function branchNodeCount(branch: MindNodeClipboard): number {
  return 1 + branch.children.reduce((count, child) => count + branchNodeCount(child), 0)
}
