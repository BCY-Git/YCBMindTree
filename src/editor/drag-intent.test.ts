import { describe, expect, it } from 'vitest'
import { resolveRegularTreeDragIntent } from './drag-intent'

const reorder = { parentId: 'parent', index: 3, kind: 'sibling' as const }
const attach = { parentId: 'target', index: 0, kind: 'child' as const }

describe('regular tree drag intent', () => {
  it('uses a normal drag to reorder siblings instead of accidentally becoming a child', () => {
    expect(resolveRegularTreeDragIntent({ shiftKey: false, siblingIntent: reorder, structuralIntent: attach })).toEqual(reorder)
  })

  it('does not change the tree structure on a normal drag without a sibling reorder target', () => {
    expect(resolveRegularTreeDragIntent({ shiftKey: false, siblingIntent: null, structuralIntent: attach })).toBeNull()
  })

  it('allows Shift+drag to attach the node beneath a new parent', () => {
    expect(resolveRegularTreeDragIntent({ shiftKey: true, siblingIntent: reorder, structuralIntent: attach })).toEqual(attach)
  })
})
