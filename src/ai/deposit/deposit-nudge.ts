import type { MindMapDocument } from '../../domain/document.types'

function subtree(document: MindMapDocument, nodeId: string) {
  const result: string[] = []
  const visit = (id: string) => {
    const node = document.nodes[id]
    if (!node) return
    result.push(id)
    node.childIds.forEach(visit)
  }
  visit(nodeId)
  return result
}

/** 完全本地的低打扰规则，只显示入口，不自动调用模型。 */
export function depositNudgeReason(document: MindMapDocument, nodeId: string): string | null {
  const node = document.nodes[nodeId]
  if (!node) return null
  const nodeIds = subtree(document, nodeId)
  if (document.isDraft && nodeIds.length >= 3) return '这份随手记已经形成多个主题，可能值得整理。'
  if (/^(?:20\d{2}[.\-/年])?\d{1,2}[.\-/月]\d{1,2}/.test(node.topic.trim()) && node.childIds.length >= 3) return '这个日期分支可能包含项目进展、问题和下一步。'
  if (nodeIds.filter((id) => document.nodes[id].taskStatus === 'done').length >= 3) return '这一组任务已有多项完成，可能适合形成阶段总结。'
  return null
}
