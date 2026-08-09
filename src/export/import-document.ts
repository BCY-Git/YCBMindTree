import { createNode } from '../domain/document.factory'
import type { MindMapDocument, MindNodeTaskStatus } from '../domain/document.types'
import { randomUuid } from '../platform/random-uuid'

export type ImportedOutlineNode = {
  topic: string
  note?: string
  collapsed?: boolean
  taskStatus?: MindNodeTaskStatus
  children?: ImportedOutlineNode[]
}

export type ImportSummary = { nodeCount: number; maxDepth: number }
export type ImportedDocument = { document: MindMapDocument; summary: ImportSummary }

export function createDocumentFromOutline(title: string, rootOutline: ImportedOutlineNode): ImportedDocument {
  const nodes: MindMapDocument['nodes'] = {}
  let nodeCount = 0
  let maxDepth = 0

  const visit = (outline: ImportedOutlineNode, parentId: string | null, depth: number): string => {
    const node = createNode(outline.topic.trim() || '未命名主题', parentId)
    node.note = outline.note?.trim() ?? ''
    node.collapsed = outline.collapsed ?? false
    node.taskStatus = outline.taskStatus ?? 'none'
    nodes[node.id] = node
    nodeCount += 1
    maxDepth = Math.max(maxDepth, depth)
    node.childIds = (outline.children ?? []).map((child) => visit(child, node.id, depth + 1))
    return node.id
  }

  const rootId = visit(rootOutline, null, 1)
  const now = Date.now()
  return {
    document: {
      id: randomUuid(),
      schemaVersion: 1,
      title: title.trim() || rootOutline.topic.trim() || '导入的大纲',
      categoryId: 'uncategorized',
      isDraft: false,
      origin: 'standard',
      rootId,
      nodes,
      relations: [],
      boundaries: [],
      summaries: [],
      layout: { levelGap: 96, siblingGap: 22, freeformOffsets: null },
      theme: { id: 'calm' },
      createdAt: now,
      updatedAt: now,
    },
    summary: { nodeCount, maxDepth },
  }
}

export function fileStem(fileName: string) {
  return fileName.replace(/\.(opml|xml|md|markdown)$/i, '').trim() || '导入的大纲'
}
