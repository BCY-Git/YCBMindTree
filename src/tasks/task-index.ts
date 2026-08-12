import type { MindMapDocument, MindNodePriority, MindNodeTaskStatus, NodeMark } from '@/domain/document.types'

export type MindTreeTask = {
  documentId: string
  documentTitle: string
  isDraft: boolean
  nodeId: string
  topic: string
  status: Exclude<MindNodeTaskStatus, 'none'>
  priority: MindNodePriority
  dueDate: string | null
  marks: NodeMark[]
  tagIds: string[]
  /** 从中心主题到当前节点，任务中心用它解释任务上下文。 */
  path: string[]
  parentProgress: { done: number; total: number } | null
  updatedAt: number
}

const statusOrder: Record<MindTreeTask['status'], number> = { todo: 0, doing: 1, done: 2 }

/** 从所有本地导图派生任务，不额外写入或复制任务数据。 */
export function collectTasks(documents: MindMapDocument[]): MindTreeTask[] {
  return documents.flatMap((document) => Object.values(document.nodes).flatMap((node) => node.taskStatus === 'none' ? [] : [{
    documentId: document.id,
    documentTitle: document.title,
    isDraft: document.isDraft,
    nodeId: node.id,
    topic: node.topic,
    status: node.taskStatus,
    priority: node.priority,
    dueDate: node.dueDate,
    marks: node.marks,
    tagIds: node.tagIds,
    path: nodePath(document, node.id),
    parentProgress: node.parentId ? subtreeTaskProgress(document, node.parentId) : null,
    updatedAt: node.updatedAt,
  }])).sort((left, right) => {
    const leftPriority = left.priority || 9
    const rightPriority = right.priority || 9
    const leftDate = left.status === 'done' ? '9999-12-31' : left.dueDate ?? '9999-12-31'
    const rightDate = right.status === 'done' ? '9999-12-31' : right.dueDate ?? '9999-12-31'
    return statusOrder[left.status] - statusOrder[right.status] || leftDate.localeCompare(rightDate) || leftPriority - rightPriority || right.updatedAt - left.updatedAt
  })
}

export function nodePath(document: MindMapDocument, nodeId: string): string[] {
  const path: string[] = []
  let current: MindMapDocument['nodes'][string] | undefined = document.nodes[nodeId]
  while (current) {
    path.unshift(current.topic)
    current = current.parentId ? document.nodes[current.parentId] : undefined
  }
  return path
}

/** 只计算数据，不触碰画布：任务中心按需展示父分支的完成进度。 */
export function subtreeTaskProgress(document: MindMapDocument, nodeId: string): { done: number; total: number } {
  const node = document.nodes[nodeId]
  if (!node) return { done: 0, total: 0 }
  let done = node.taskStatus === 'done' ? 1 : 0
  let total = node.taskStatus === 'none' ? 0 : 1
  node.childIds.forEach((childId) => {
    const progress = subtreeTaskProgress(document, childId)
    done += progress.done
    total += progress.total
  })
  return { done, total }
}
