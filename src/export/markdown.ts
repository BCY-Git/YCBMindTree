import type { MindMapDocument, MindNode } from '../domain/document.types'
import { loadTags } from '../domain/tag-library'
import { nodeMarkMeta } from '../domain/node-semantics'
import { saveExportFile } from './export-file'

export type MarkdownExportMode = 'outline' | 'minutes' | 'ai-context' | 'tasks'

function nodeExtras(node: MindNode, prefix = ''): string[] {
  const lines: string[] = []
  if (node.dueDate) lines.push(`${prefix}- 截止日期：${node.dueDate}`)
  if (node.note.trim()) lines.push(...node.note.trim().split('\n').map((line) => `${prefix}> ${line}`))
  node.links.forEach((link) => lines.push(`${prefix}- 链接：[${link.label || link.url}](${link.url})`))
  node.attachments.forEach((attachment) => lines.push(`${prefix}- 附件：${attachment.name}（仅本机）`))
  return lines
}

function nodeMarkerPrefix(node: MindNode): string {
  const task = node.taskStatus === 'todo' ? '☐ 待办 ' : node.taskStatus === 'doing' ? '◐ 进行中 ' : node.taskStatus === 'done' ? '☑ 已完成 ' : ''
  const priority = node.priority > 0 ? `[P${node.priority}] ` : ''
  const marks = node.marks.map((mark) => `[${nodeMarkMeta[mark].label}]`).join(' ')
  const tags = node.tagIds.map((id) => `#${tagName(id)}`).join(' ')
  return `${task}${priority}${marks}${marks && tags ? ' ' : ''}${tags}${(marks || tags) ? ' ' : ''}`
}

function tagName(id: string) {
  return loadTags().find((tag) => tag.id === id)?.name ?? id
}

function outline(document: MindMapDocument) {
  const lines = [`# ${document.title}`, '']
  const visit = (nodeId: string, depth: number) => {
    const node = document.nodes[nodeId]
    const prefix = '  '.repeat(depth)
    lines.push(`${prefix}- ${nodeMarkerPrefix(node)}${node.topic}`)
    lines.push(...nodeExtras(node, `${prefix}  `))
    node.childIds.forEach((childId) => visit(childId, depth + 1))
  }
  visit(document.rootId, 0)
  return lines.join('\n')
}

function minutes(document: MindMapDocument) {
  const lines = [`# ${document.title}`, '', '> 由 MindTree 导出，可继续补充结论、负责人和截止时间。', '']
  const visit = (nodeId: string, depth: number) => {
    const node = document.nodes[nodeId]
    const heading = Math.min(depth + 2, 6)
    lines.push(`${'#'.repeat(heading)} ${nodeMarkerPrefix(node)}${node.topic}`, '')
    if (node.note.trim()) lines.push(node.note.trim(), '')
    if (node.links.length || node.attachments.length) lines.push(...nodeExtras(node), '')
    node.childIds.forEach((childId) => visit(childId, depth + 1))
  }
  const root = document.nodes[document.rootId]
  if (root.note.trim()) lines.push(root.note.trim(), '')
  root.childIds.forEach((childId) => visit(childId, 0))
  return lines.join('\n').trimEnd()
}

function aiContext(document: MindMapDocument) {
  const lines = [`# Mind map context: ${document.title}`, '', 'Use the following tree as source context. Preserve its hierarchy and do not invent missing details.', '']
  const visit = (nodeId: string, path: string[]) => {
    const node = document.nodes[nodeId]
    const nextPath = [...path, node.topic]
    lines.push(`## ${nextPath.map((topic, index) => index === nextPath.length - 1 ? `${nodeMarkerPrefix(node)}${topic}` : topic).join(' / ')}`)
    if (node.note.trim()) lines.push(`Note: ${node.note.trim()}`)
    if (node.links.length) lines.push(`Links: ${node.links.map((link) => `${link.label || link.url} (${link.url})`).join('; ')}`)
    if (node.attachments.length) lines.push(`Local attachments: ${node.attachments.map((attachment) => attachment.name).join(', ')}`)
    if (!node.note.trim() && !node.links.length && !node.attachments.length) lines.push('No additional note.')
    lines.push('')
    node.childIds.forEach((childId) => visit(childId, nextPath))
  }
  visit(document.rootId, [])
  return lines.join('\n').trimEnd()
}

function tasks(document: MindMapDocument) {
  const lines = [`# ${document.title} · 任务清单`, '']
  const visit = (nodeId: string, path: string[]) => {
    const node = document.nodes[nodeId]
    const nextPath = [...path, node.topic]
    if (node.taskStatus !== 'none') {
      const checked = node.taskStatus === 'done' ? 'x' : ' '
      const details = [node.priority > 0 ? `P${node.priority}` : '', node.dueDate ? `截止 ${node.dueDate}` : '', ...node.marks.map((mark) => nodeMarkMeta[mark].label), ...node.tagIds.map((id) => `#${tagName(id)}`)].filter(Boolean)
      lines.push(`- [${checked}] ${nextPath.join(' › ')}${details.length ? ` · ${details.join(' · ')}` : ''}`)
    }
    node.childIds.forEach((childId) => visit(childId, nextPath))
  }
  visit(document.rootId, [])
  return lines.join('\n')
}

export function exportMarkdown(document: MindMapDocument, mode: MarkdownExportMode): string {
  if (mode === 'tasks') return tasks(document)
  if (mode === 'minutes') return minutes(document)
  if (mode === 'ai-context') return aiContext(document)
  return outline(document)
}

export function downloadMarkdown(document: MindMapDocument, mode: MarkdownExportMode) {
  const safeName = document.title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'mindtree'
  const label: Record<MarkdownExportMode, string> = { outline: 'Markdown 大纲', minutes: '会议纪要', tasks: '任务清单', 'ai-context': 'AI 上下文' }
  return saveExportFile({
    content: exportMarkdown(document, mode),
    suggestedName: `${safeName}-${mode}.md`,
    dialogTitle: `导出${label[mode]}`,
    typeName: 'Markdown',
    extensions: ['md'],
    mimeType: 'text/markdown;charset=utf-8',
  })
}
