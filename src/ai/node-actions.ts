/**
 * node-actions — 节点级 AI 动作。
 *
 * 供三处入口共用：选中节点的浮动工具条（NodeAiToolbar）、右键菜单（ContextMenu）、
 * 命令面板（CommandPalette）。生成类动作统一走 generated-branch 的结构化协议，
 * 输出由 parseGeneratedBranch 校验后才允许上图；所有写入仍经 store 的命令边界，可撤销。
 */
import type { AiSettings } from './ai-settings'
import { chatUrl } from './ai-settings'
import type { MindMapDocument } from '../domain/document.types'
import type { MindNodeClipboard } from '../domain/commands'
import { requestAiChat } from '../platform/tauri'
import { parseGeneratedBranch } from './generated-branch'

export type NodeAiAction = 'expand-ideas' | 'expand-branch' | 'summarize' | 'tasks'

export const nodeAiActionMeta: Record<NodeAiAction, { label: string; working: string }> = {
  'expand-ideas': { label: '扩展想法', working: '正在扩展 3 个想法…' },
  'expand-branch': { label: '扩展分支（多级）', working: '正在生成分支…' },
  'summarize': { label: '总结分支', working: '正在总结分支…' },
  'tasks': { label: '拆解为任务', working: '正在拆解任务…' },
}

type ChatResponse = { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }

/** AI 未配置时的统一提示；返回 null 表示可用。 */
export function aiConfigurationError(settings: AiSettings, isDev: boolean): string | null {
  if (!settings.endpoint.trim() || !settings.model.trim() || (!settings.apiKey.trim() && !isDev)) {
    return '请先在 AI 工作台配置模型和 API Key'
  }
  return null
}

const maxSubtreeNodes = 60

function subtreeOutline(document: MindMapDocument, nodeId: string, depth: number, budget: { count: number }): string {
  const node = document.nodes[nodeId]
  if (!node || budget.count >= maxSubtreeNodes || depth > 4) return ''
  budget.count += 1
  const lines = [`${'  '.repeat(depth)}- ${node.topic}`]
  for (const childId of node.childIds) {
    const child = subtreeOutline(document, childId, depth + 1, budget)
    if (child) lines.push(child)
  }
  return lines.join('\n')
}

/** 构建发给模型的 system / user 消息；纯函数，便于测试。 */
export function buildNodeAiRequest(document: MindMapDocument, nodeId: string, action: Exclude<NodeAiAction, 'expand-ideas'>, customPrompt?: string) {
  const node = document.nodes[nodeId]
  if (!node) throw new Error('当前节点已不存在')
  const ancestors: string[] = []
  let current = node.parentId ? document.nodes[node.parentId] : null
  while (current) {
    ancestors.unshift(current.topic)
    current = current.parentId ? document.nodes[current.parentId] : null
  }
  const context: Record<string, unknown> = {
    mapTitle: document.title,
    path: [...ancestors, node.topic],
    topic: node.topic,
    note: node.note.slice(0, 800),
    existingChildren: node.childIds.map((id) => document.nodes[id]?.topic).filter(Boolean),
  }
  let system: string
  if (action === 'expand-branch') {
    system = [
      '你是 MindTree 的节点扩展助手。围绕「当前主题」生成一棵 2 到 3 层的有层级分支树。',
      '要求：',
      '- 第一层给出 3-5 个互不重复、不与已有子节点重复的方向；每个方向下可有 2-4 个更具体的子点，不要出现第四层；',
      '- 每个 topic 是不超过 20 字的简洁中文短语，不带编号，不加解释；',
      '- 只返回合法 JSON：{"topic":"当前主题原文","children":[{"topic":"方向","children":[{"topic":"子点","children":[]}]}]}',
    ].join('\n')
  } else if (action === 'summarize') {
    context.subtree = subtreeOutline(document, nodeId, 0, { count: 0 })
    system = [
      '你是 MindTree 的分支总结助手。阅读「子树内容」，输出一个名为「总结」的分支。',
      '要求：',
      '- children 为 3-6 个要点；每个要点可带 1-2 个支撑细节作为 children，不要更深的层级；',
      '- 要点是不超过 24 字的简洁中文短句，忠实于子树内容，不要编造；',
      '- 只返回合法 JSON：{"topic":"总结","children":[{"topic":"要点","children":[]}]}',
    ].join('\n')
  } else {
    system = [
      '你是 MindTree 的任务拆解助手。把「当前主题」拆解为可以直接执行的任务分支。',
      '要求：',
      '- children 为 3-6 个任务，每个任务带 "taskStatus":"todo"；必要时带 1-3 个执行步骤作为 children（同样为 todo），不要更深的层级；',
      '- 任务以动词开头，不超过 20 字，具体可执行；',
      '- 只返回合法 JSON：{"topic":"当前主题原文","children":[{"topic":"任务","taskStatus":"todo","children":[]}]}',
    ].join('\n')
  }
  const user = customPrompt?.trim()
    ? `${JSON.stringify(context)}\n\n用户补充要求：${customPrompt.trim().slice(0, 300)}`
    : JSON.stringify(context)
  return { system, user }
}

/** expand-branch / tasks 的根节点只是当前主题的回声，插入时剥掉根；summarize 保留「总结」根节点。 */
export function unwrapNodeAiBranches(branch: MindNodeClipboard, action: Exclude<NodeAiAction, 'expand-ideas'>): MindNodeClipboard[] {
  if (action === 'summarize') return [branch]
  return branch.children.length ? branch.children : [branch]
}

export async function requestNodeAiBranches(
  settings: AiSettings,
  document: MindMapDocument,
  nodeId: string,
  action: Exclude<NodeAiAction, 'expand-ideas'>,
  customPrompt?: string,
  signal?: AbortSignal,
): Promise<MindNodeClipboard[]> {
  const { system, user } = buildNodeAiRequest(document, nodeId, action, customPrompt)
  const response = await requestAiChat(chatUrl(settings.endpoint), {
    model: settings.model.trim(),
    temperature: 0.55,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }, settings.apiKey, signal)
  const payload = await response.json().catch(() => ({})) as ChatResponse
  if (!response.ok) throw new Error(payload.error?.message || `AI 请求失败（${response.status}）`)
  const content = payload.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('AI 没有返回内容')
  const branch = parseGeneratedBranch(content)
  const branches = unwrapNodeAiBranches(branch, action)
  if (!branches.length) throw new Error('AI 没有返回有效分支')
  return branches
}

/** 「向 AI 提问」通过自定义事件冒泡给 App 层打开 AI 工作台并预填上下文。 */
export const askAiAboutNodeEvent = 'mindtree:ask-ai-about-node'

export function askAiAboutNode(nodeId: string) {
  window.dispatchEvent(new CustomEvent(askAiAboutNodeEvent, { detail: { nodeId } }))
}
