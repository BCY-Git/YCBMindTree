import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { retainDraggingNodePosition, translateDraggedSubtree } from '@/editor/drag-state'

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

  it('keeps a dragged branch subtree together while drop hints recalculate layout nodes', () => {
    const current = [
      { id: 'branch', position: { x: 340, y: 160 }, data: { isDropTarget: false }, dragging: true },
      { id: 'child', position: { x: 530, y: 180 }, data: { isDropTarget: false } },
    ] as Node<TestNodeData>[]
    const recalculated = [
      { id: 'branch', position: { x: 120, y: 80 }, data: { isDropTarget: false } },
      { id: 'child', position: { x: 310, y: 100 }, data: { isDropTarget: true } },
    ] as Node<TestNodeData>[]

    const next = retainDraggingNodePosition(recalculated, current, 'branch', new Set(['branch', 'child']))

    expect(next.find((node) => node.id === 'branch')?.position).toEqual({ x: 340, y: 160 })
    expect(next.find((node) => node.id === 'child')).toMatchObject({ position: { x: 530, y: 180 }, data: { isDropTarget: true } })
  })

  it('moves every visible descendant together with a dragged branch root', () => {
    const current = [
      { id: 'branch', position: { x: 120, y: 80 }, data: { isDropTarget: false } },
      { id: 'child', position: { x: 310, y: 100 }, data: { isDropTarget: false } },
      { id: 'other', position: { x: 80, y: 260 }, data: { isDropTarget: false } },
    ] as Node<TestNodeData>[]

    const moved = translateDraggedSubtree(current, 'branch', { x: 340, y: 160 }, new Set(['branch', 'child']))

    expect(moved.find((node) => node.id === 'branch')?.position).toEqual({ x: 340, y: 160 })
    expect(moved.find((node) => node.id === 'child')?.position).toEqual({ x: 530, y: 180 })
    expect(moved.find((node) => node.id === 'other')?.position).toEqual({ x: 80, y: 260 })
  })
})
