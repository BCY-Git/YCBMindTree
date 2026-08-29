import { describe, expect, it } from 'vitest'
import { getMindTreePath, getTreeBranchColor, getTreeEdgeAnchors } from '@/editor/tree-edge'

describe('tree edge anchors', () => {
  const parent = { id: 'parent', x: 300, y: 200, width: 160, height: 44 }

  it('connects a child on the right from parent-right to child-left', () => {
    expect(getTreeEdgeAnchors(parent, { id: 'right', x: 580, y: 250, width: 140, height: 44 })).toEqual({
      sourceHandle: 'source-right', targetHandle: 'target-left',
    })
  })

  it('flips anchors when a manually moved child crosses to the left', () => {
    expect(getTreeEdgeAnchors(parent, { id: 'left', x: 80, y: 250, width: 140, height: 44 })).toEqual({
      sourceHandle: 'source-left', targetHandle: 'target-right',
    })
  })

})

describe('Drawnix-style tree edge', () => {
  it('starts a root branch directly with a cubic curve', () => {
    expect(getMindTreePath({ sourceX: 100, sourceY: 50, targetX: 220, targetY: 90, fromRoot: true }))
      .toBe('M 100 50 C 140 50, 170 90, 220 90')
  })

  it('adds the short Plait stem for a nested branch and supports left-facing nodes', () => {
    expect(getMindTreePath({ sourceX: 220, sourceY: 90, targetX: 100, targetY: 40, fromRoot: false }))
      .toBe('M 220 90 L 212 90 C 174.667 90, 146.667 40, 100 40')
  })

  it('inherits one color through every descendant of a top-level branch', () => {
    const document = {
      rootId: 'root',
      nodes: {
        root: { id: 'root', parentId: null, childIds: ['first', 'second'] },
        first: { id: 'first', parentId: 'root', childIds: ['nested'] },
        nested: { id: 'nested', parentId: 'first', childIds: [] },
        second: { id: 'second', parentId: 'root', childIds: [] },
      },
    } as any
    expect(getTreeBranchColor(document, 'first', ['#f80', '#08f'], '#aaa')).toBe('#f80')
    expect(getTreeBranchColor(document, 'nested', ['#f80', '#08f'], '#aaa')).toBe('#f80')
    expect(getTreeBranchColor(document, 'second', ['#f80', '#08f'], '#aaa')).toBe('#08f')
    expect(getTreeBranchColor(document, 'root', ['#f80', '#08f'], '#aaa')).toBe('#aaa')
  })
})
