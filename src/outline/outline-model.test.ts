import { describe, expect, it } from 'vitest'
import { createInitialDocument, createNode } from '../domain/document.factory'
import { buildOutlineRows, outlineSiblingMove } from './outline-model'

describe('outline model', () => {
  it('lists tree nodes in document order with their hierarchy depth', () => {
    const document = createInitialDocument()
    const root = document.nodes[document.rootId]
    const first = createNode('第一分支', root.id)
    const child = createNode('分支结论', first.id)
    const second = createNode('第二分支', root.id)
    root.childIds = [first.id, second.id]
    first.childIds = [child.id]
    document.nodes = { [root.id]: root, [first.id]: first, [child.id]: child, [second.id]: second }

    expect(buildOutlineRows(document).map(({ nodeId, depth }) => ({ nodeId, depth }))).toEqual([
      { nodeId: root.id, depth: 0 },
      { nodeId: first.id, depth: 1 },
      { nodeId: child.id, depth: 2 },
      { nodeId: second.id, depth: 1 },
    ])
  })

  it('respects folded branches and still exposes free topics', () => {
    const document = createInitialDocument()
    const root = document.nodes[document.rootId]
    const branch = createNode('已折叠', root.id)
    const child = createNode('暂时隐藏', branch.id)
    const free = createNode('自由想法', null)
    const freeChild = createNode('自由分支', free.id)
    branch.collapsed = true
    branch.childIds = [child.id]
    free.isFreeTopic = true
    free.childIds = [freeChild.id]
    root.childIds = [branch.id]
    document.nodes = { [root.id]: root, [branch.id]: branch, [child.id]: child, [free.id]: free, [freeChild.id]: freeChild }

    expect(buildOutlineRows(document).map(({ nodeId, depth, hiddenChildCount }) => ({ nodeId, depth, hiddenChildCount }))).toEqual([
      { nodeId: root.id, depth: 0, hiddenChildCount: 0 },
      { nodeId: branch.id, depth: 1, hiddenChildCount: 1 },
      { nodeId: free.id, depth: 0, hiddenChildCount: 0 },
      { nodeId: freeChild.id, depth: 1, hiddenChildCount: 0 },
    ])
  })

  it('describes a safe sibling reorder without mutating the document', () => {
    const document = createInitialDocument()
    const root = document.nodes[document.rootId]
    const first = createNode('第一项', root.id)
    const second = createNode('第二项', root.id)
    root.childIds = [first.id, second.id]
    document.nodes = { [root.id]: root, [first.id]: first, [second.id]: second }

    expect(outlineSiblingMove(document, second.id, 'up')).toEqual({ type: 'MOVE_NODE', nodeId: second.id, newParentId: root.id, index: 0 })
    expect(outlineSiblingMove(document, first.id, 'up')).toBeNull()
    expect(root.childIds).toEqual([first.id, second.id])
  })
})
