import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '@/domain/document.factory'
import { parseMapReorganization } from '@/ai/map-reorganization'

describe('AI map reorganization parser', () => {
  it('accepts only existing ordinary nodes and returns a previewable move list', () => {
    const document = createInitialDocument()
    const parentId = document.nodes[document.rootId].childIds[0]
    const nodeId = document.nodes[parentId].childIds[0]
    const plan = parseMapReorganization(JSON.stringify({ summary: '把概念归入中心主题', moves: [{ nodeId, newParentId: document.rootId, index: 1 }] }), document)

    expect(plan).toEqual({ summary: '把概念归入中心主题', moves: [{ nodeId, newParentId: document.rootId, index: 1 }] })
  })

  it('rejects cyclic or hallucinated node references before the user can apply them', () => {
    const document = createInitialDocument()
    const parentId = document.nodes[document.rootId].childIds[0]
    const childId = document.nodes[parentId].childIds[0]

    expect(() => parseMapReorganization(JSON.stringify({ moves: [{ nodeId: 'not-real', newParentId: parentId }] }), document)).toThrow('不存在')
    expect(() => parseMapReorganization(JSON.stringify({ moves: [{ nodeId: parentId, newParentId: childId }] }), document)).toThrow('循环')
  })
})
