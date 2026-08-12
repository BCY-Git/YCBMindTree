import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '@/domain/document.factory'
import { mindMapDocumentSchema } from '@/domain/document.schema'

describe('mind map document schema', () => {
  it('fills relation styling defaults when loading a legacy document', () => {
    const document = createInitialDocument()
    const sourceId = document.rootId
    const targetId = document.nodes[sourceId].childIds[0]
    const legacy = structuredClone(document) as unknown as Record<string, unknown>
    legacy.relations = [{ id: crypto.randomUUID(), sourceId, targetId, label: '相关', createdAt: 1, updatedAt: 1 }]

    const parsed = mindMapDocumentSchema.parse(legacy)

    expect(parsed.relations[0]).toMatchObject({ lineStyle: 'dashed', color: null, controlOffsetX: 0, controlOffsetY: 0 })
  })
})
