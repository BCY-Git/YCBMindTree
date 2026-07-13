import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { retainDraggingNodePosition } from './drag-state'

type TestNodeData = { isDropTarget: boolean }

describe('drag state reconciliation', () => {
  it('keeps a free topic at its live drag position when the nearby attachment target changes', () => {
    const current = [
      { id: 'free', position: { x: 480, y: 236 }, data: { isDropTarget: false }, dragging: true },
      { id: 'parent', position: { x: 180, y: 120 }, data: { isDropTarget: false } },
    ] as Node<TestNodeData>[]
    const recalculated = [
      { id: 'free', position: { x: 80, y: 40 }, data: { isDropTarget: false } },
      { id: 'parent', position: { x: 180, y: 120 }, data: { isDropTarget: true } },
    ] as Node<TestNodeData>[]

    const next = retainDraggingNodePosition(recalculated, current, 'free')

    expect(next.find((node) => node.id === 'free')).toMatchObject({ position: { x: 480, y: 236 }, dragging: true })
    expect(next.find((node) => node.id === 'parent')?.data.isDropTarget).toBe(true)
  })
})
