import { describe, expect, it } from 'vitest'
import { resolveRegularTreeDragIntent, shouldDetachTreeBranch, stabilizeTreeDropIntent } from '@/editor/drag-intent'

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

  it('uses elapsed time rather than pointer event count to stabilize a new target', () => {
    const first = stabilizeTreeDropIntent({ current: null, pending: null, next: attach, now: 1_000 })
    const second = stabilizeTreeDropIntent({ current: null, pending: first.pending, next: attach, now: 1_070 })
    const settled = stabilizeTreeDropIntent({ current: null, pending: second.pending, next: attach, now: 1_100 })

    expect(first.current).toBeNull()
    expect(second.current).toBeNull()
    expect(settled.current).toEqual(attach)
  })

  it('holds an existing target slightly longer before clearing it', () => {
    const first = stabilizeTreeDropIntent({ current: attach, pending: null, next: null, now: 1_000 })
    const settled = stabilizeTreeDropIntent({ current: attach, pending: first.pending, next: null, now: 1_150 })

    expect(first.current).toEqual(attach)
    expect(settled.current).toBeNull()
  })
})
