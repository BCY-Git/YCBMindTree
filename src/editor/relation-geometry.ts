export type RelationLineStyle = 'solid' | 'dashed' | 'dotted'

type Point = { x: number; y: number }

const relationHandleT = .38
const relationLabelT = .62

export function quadraticPointAt(source: Point, target: Point, control: Point, t: number) {
  const remaining = 1 - t
  return {
    x: remaining * remaining * source.x + 2 * remaining * t * control.x + t * t * target.x,
    y: remaining * remaining * source.y + 2 * remaining * t * control.y + t * t * target.y,
  }
}

export function relationControlPoint(source: Point, target: Point, offsetX = 0, offsetY = 0) {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const length = Math.max(1, Math.hypot(dx, dy))
  const bend = Math.min(96, Math.max(42, length * .17))
  return {
    x: (source.x + target.x) / 2 - (dy / length) * bend + offsetX,
    y: (source.y + target.y) / 2 + (dx / length) * bend + offsetY,
  }
}

export function relationPath(source: Point, target: Point, control: Point) {
  return {
    path: `M ${source.x} ${source.y} Q ${control.x} ${control.y} ${target.x} ${target.y}`,
    handle: quadraticPointAt(source, target, control, relationHandleT),
    label: quadraticPointAt(source, target, control, relationLabelT),
  }
}

export function relationControlForCurvePoint(source: Point, target: Point, point: Point, t = relationHandleT) {
  const remaining = 1 - t
  const controlWeight = 2 * remaining * t
  if (controlWeight <= 0) return relationControlPoint(source, target)
  return {
    x: (point.x - remaining * remaining * source.x - t * t * target.x) / controlWeight,
    y: (point.y - remaining * remaining * source.y - t * t * target.y) / controlWeight,
  }
}

export function relationDashArray(style: RelationLineStyle) {
  if (style === 'dashed') return '9 7'
  if (style === 'dotted') return '2 7'
  return undefined
}
