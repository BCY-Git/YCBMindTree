import { describe, expect, it } from 'vitest'
import { getTreeEdgeAnchors } from '@/editor/tree-edge'

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
