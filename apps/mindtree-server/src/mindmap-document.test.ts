import { describe, expect, it } from 'vitest'
import { mindMapDocumentSchema } from './mindmap-document.js'

describe('server mind map document schema', () => {
  it('accepts legacy relationships and applies style defaults', () => {
    const rootId = crypto.randomUUID()
    const childId = crypto.randomUUID()
    const now = Date.now()
    const node = (id: string, parentId: string | null, childIds: string[]) => ({
      id, parentId, childIds, isFreeTopic: false, topic: '主题', note: '', links: [], attachments: [], taskStatus: 'none', priority: 0,
      dueDate: null, marks: [], tagIds: [], collapsed: false, width: null, height: null, offsetX: 0, offsetY: 0, createdAt: now, updatedAt: now,
    })
    const parsed = mindMapDocumentSchema.parse({
      id: crypto.randomUUID(), schemaVersion: 1, title: '旧文档', categoryId: 'uncategorized', rootId,
      nodes: { [rootId]: node(rootId, null, [childId]), [childId]: node(childId, rootId, []) },
      relations: [{ id: crypto.randomUUID(), sourceId: rootId, targetId: childId, label: '相关', createdAt: now, updatedAt: now }],
      boundaries: [], summaries: [], layout: { levelGap: 96, siblingGap: 22, freeformOffsets: null }, theme: { id: 'calm' }, createdAt: now, updatedAt: now,
    })

    expect(parsed.relations[0]).toMatchObject({ lineStyle: 'dashed', color: null, controlOffsetX: 0, controlOffsetY: 0 })
  })
})
