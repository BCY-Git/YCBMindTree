import { describe, expect, it } from 'vitest'
import { getTreeBranchGeometry, getTreeBranchPath, getTreeEdgeAnchors } from './tree-edge'

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

  it('gives sibling edges one shared junction between the parent and children', () => {
    const topChild = { id: 'top', x: 580, y: 160, width: 140, height: 44 }
    const bottomChild = { id: 'bottom', x: 580, y: 300, width: 140, height: 44 }

    expect(getTreeBranchGeometry(parent, topChild, [topChild, bottomChild])).toMatchObject({
      sourceHandle: 'source-right',
      targetHandle: 'target-left',
      junctionX: 520,
    })
    expect(getTreeBranchGeometry(parent, bottomChild, [topChild, bottomChild]).junctionX).toBe(520)
  })

  it('draws a continuous orthogonal branch through the shared junction', () => {
    expect(getTreeBranchPath({ sourceX: 460, sourceY: 222, junctionX: 520, targetX: 580, targetY: 322 })).toBe('M 460 222 H 520 V 322 H 580')
  })
})
