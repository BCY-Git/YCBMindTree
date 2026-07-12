import type { MindMapDocument, MindNodePriority, MindNodeTaskStatus } from '../domain/document.types'

export type MindTreeTask = {
  documentId: string
  documentTitle: string
  isDraft: boolean
  nodeId: string
  topic: string
  status: Exclude<MindNodeTaskStatus, 'none'>
  priority: MindNodePriority
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
    updatedAt: node.updatedAt,
  }])).sort((left, right) => {
    const leftPriority = left.priority || 9
    const rightPriority = right.priority || 9
    return statusOrder[left.status] - statusOrder[right.status] || leftPriority - rightPriority || right.updatedAt - left.updatedAt
  })
}
