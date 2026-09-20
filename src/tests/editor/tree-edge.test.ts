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

const pathNumbers = (path: string) => path.match(/-?\d+(?:\.\d+)?/g)!.map(Number)

describe('XMind-style tree edge', () => {
  it('keeps a centered child on a straight horizontal line', () => {
    const path = getMindTreePath({ sourceX: 100, sourceY: 50, targetX: 220, targetY: 50, fromRoot: false })
    const ys = pathNumbers(path).filter((_, index) => index % 2 === 1)
    expect(ys.length).toBeGreaterThan(0)
    expect(ys.every((y) => y === 50)).toBe(true)
  })

  it('starts at the source, ends at the target and bends through the shared trunk axis', () => {
    const path = getMindTreePath({ sourceX: 100, sourceY: 50, targetX: 220, targetY: 90, fromRoot: true })
    // 主干 x = 100 + min(48, max(24, 120 * .42)) = 148
    expect(path.startsWith('M100 50')).toBe(true)
    expect(path.trimEnd().endsWith('220 90')).toBe(true)
    expect(path).toContain('Q')
    expect(pathNumbers(path).filter((_, index) => index % 2 === 0)).toContain(148)
  })

  it('clamps the trunk axis within 24~48px from the parent for any distance', () => {
    for (const distance of [40, 120, 400, 1000]) {
      const path = getMindTreePath({ sourceX: 0, sourceY: 0, targetX: distance, targetY: 80, fromRoot: false })
      const trunkX = Math.min(48, Math.max(24, distance * .42))
      expect(pathNumbers(path).filter((_, index) => index % 2 === 0)).toContain(trunkX)
    }
  })

  it('mirrors upper and lower children around the parent axis', () => {
    const down = pathNumbers(getMindTreePath({ sourceX: 100, sourceY: 50, targetX: 220, targetY: 90, fromRoot: true }))
    const up = pathNumbers(getMindTreePath({ sourceX: 100, sourceY: 90, targetX: 220, targetY: 50, fromRoot: true }))
    // 以 y=70 为轴镜像上方路径后应与下方路径逐点一致
    expect(up.map((value, index) => (index % 2 === 1 ? 140 - value : value))).toEqual(down)
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
