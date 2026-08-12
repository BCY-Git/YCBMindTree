import { describe, expect, it } from 'vitest'
import { relationControlForCurvePoint, relationControlPoint, relationDashArray, relationPath } from '@/editor/relation-geometry'

describe('relation edge geometry', () => {
  it('creates a curved default control point and preserves manual offsets', () => {
    const source = { x: 0, y: 0 }
    const target = { x: 200, y: 0 }
    const base = relationControlPoint(source, target)
    const moved = relationControlPoint(source, target, 30, -20)

    expect(base).toEqual({ x: 100, y: 42 })
    expect(moved).toEqual({ x: 130, y: 22 })
  })

  it('places the drag handle on the curve and keeps it separate from the label', () => {
    const geometry = relationPath({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 80 })

    expect(geometry.path).toBe('M 0 0 Q 100 80 200 0')
    expect(geometry.handle.x).toBeCloseTo(76)
    expect(geometry.handle.y).toBeCloseTo(37.696)
    expect(geometry.label.x).toBeCloseTo(124)
    expect(geometry.label.y).toBeCloseTo(37.696)
  })

  it('converts a dragged point on the curve back into a bezier control point', () => {
    const source = { x: 0, y: 0 }
    const target = { x: 200, y: 0 }
    const desiredHandle = { x: 76, y: 68 }

    const control = relationControlForCurvePoint(source, target, desiredHandle)
    const geometry = relationPath(source, target, control)

    expect(geometry.handle.x).toBeCloseTo(desiredHandle.x)
    expect(geometry.handle.y).toBeCloseTo(desiredHandle.y)
  })

  it('maps each visible line style to a stable stroke pattern', () => {
    expect(relationDashArray('solid')).toBeUndefined()
    expect(relationDashArray('dashed')).toBe('9 7')
    expect(relationDashArray('dotted')).toBe('2 7')
  })
})
