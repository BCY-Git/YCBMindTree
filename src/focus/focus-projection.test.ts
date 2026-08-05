import { describe, expect, it } from 'vitest'
import { createInitialDocument, createNode } from '../domain/document.factory'
import { buildFocusBreadcrumb, projectFocusedDocument } from './focus-projection'

describe('focus projection', () => {
  it('projects one branch without mutating the full document', () => {
    const document = createInitialDocument()
    const root = document.nodes[document.rootId]
    const focus = createNode('当前阶段', root.id)
    const child = createNode('下一步', focus.id)
    const sibling = createNode('其他项目', root.id)
    focus.childIds = [child.id]
    root.childIds = [focus.id, sibling.id]
    document.nodes = { [root.id]: root, [focus.id]: focus, [child.id]: child, [sibling.id]: sibling }

    const projection = projectFocusedDocument(document, focus.id)

    expect(projection.rootId).toBe(focus.id)
    expect(Object.keys(projection.nodes)).toEqual([focus.id, child.id])
    expect(projection.nodes[focus.id].parentId).toBeNull()
    expect(document.nodes[focus.id].parentId).toBe(root.id)
    expect(buildFocusBreadcrumb(document, focus.id).map((item) => item.topic)).toEqual(['我的思维导图', '当前阶段'])
  })

  it('keeps only relations and groups fully explainable inside the focused branch', () => {
    const document = createInitialDocument()
    const root = document.nodes[document.rootId]
    const focus = createNode('当前阶段', root.id)
    const first = createNode('方案', focus.id)
    const second = createNode('结论', focus.id)
    const outside = createNode('其他项目', root.id)
    focus.childIds = [first.id, second.id]
    root.childIds = [focus.id, outside.id]
    document.nodes = { [root.id]: root, [focus.id]: focus, [first.id]: first, [second.id]: second, [outside.id]: outside }
    document.relations = [
      { id: 'inside', sourceId: first.id, targetId: second.id, label: '形成', lineStyle: 'dashed', color: null, controlOffsetX: 0, controlOffsetY: 0, createdAt: 1, updatedAt: 1 },
      { id: 'outside', sourceId: first.id, targetId: outside.id, label: '无关', lineStyle: 'dashed', color: null, controlOffsetX: 0, controlOffsetY: 0, createdAt: 1, updatedAt: 1 },
    ]
    document.boundaries = [{ id: 'boundary', parentId: focus.id, nodeIds: [first.id, second.id, outside.id], label: '范围', createdAt: 1, updatedAt: 1 }]

    const projection = projectFocusedDocument(document, focus.id)

    expect(projection.relations.map((item) => item.id)).toEqual(['inside'])
    expect(projection.boundaries[0].nodeIds).toEqual([first.id, second.id])
  })
})
