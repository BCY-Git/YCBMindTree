import { describe, expect, it } from 'vitest'
import { resolveRegularTreeDragIntent, shouldDetachTreeBranch } from './drag-intent'

const reorder = { parentId: 'parent', index: 3, kind: 'sibling' as const }
const attach = { parentId: 'target', index: 0, kind: 'child' as const }

describe('regular tree drag intent', () => {
  it('uses an explicit node drop target to change hierarchy without requiring Shift', () => {
    expect(resolveRegularTreeDragIntent({ shiftKey: false, siblingIntent: reorder, structuralIntent: attach })).toEqual(attach)
  })

  it('uses a normal drag to reorder siblings when there is no node drop target', () => {
    expect(resolveRegularTreeDragIntent({ shiftKey: false, siblingIntent: reorder, structuralIntent: null })).toEqual(reorder)
  })

  it('keeps the same structural result when Shift is held for compatibility', () => {
    expect(resolveRegularTreeDragIntent({ shiftKey: true, siblingIntent: reorder, structuralIntent: attach })).toEqual(attach)
  })

  it('detaches a branch when it is dragged far away from every tree target', () => {
    expect(shouldDetachTreeBranch({ offset: { x: 210, y: 20 }, nearbyTreeIntent: null })).toBe(true)
    expect(shouldDetachTreeBranch({ offset: { x: 80, y: 20 }, nearbyTreeIntent: null })).toBe(false)
  })

  it('keeps a far drag attachable while it is still near a tree target', () => {
    expect(shouldDetachTreeBranch({ offset: { x: 210, y: 20 }, nearbyTreeIntent: attach })).toBe(false)
  })
})
