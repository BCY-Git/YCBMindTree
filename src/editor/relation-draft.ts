import { getBezierPath, Position, type XYPosition } from '@xyflow/react'

export const RELATION_TOPIC_WIDTH = 118
export const RELATION_TOPIC_HEIGHT = 44

export type RelationDraftSource = XYPosition & {
  width: number
  height: number
}

/** 将自由关系主题的中心放在用户双击点上。 */
export function relationTopicPositionAt(pointer: XYPosition) {
  return {
    x: Math.round(pointer.x - RELATION_TOPIC_WIDTH / 2),
    y: Math.round(pointer.y - RELATION_TOPIC_HEIGHT / 2),
  }
}

/** 生成与真实关系线同样的 Bezier 预览路径。 */
export function relationDraftGeometry(source: RelationDraftSource, pointer: XYPosition) {
  const sourceCenterX = source.x + source.width / 2
  const targetIsRight = pointer.x >= sourceCenterX
  const sourcePosition = targetIsRight ? Position.Right : Position.Left
  const targetPosition = targetIsRight ? Position.Left : Position.Right
  const sourceX = targetIsRight ? source.x + source.width + 5 : source.x - 5
  const sourceY = source.y + source.height * .28
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX: pointer.x,
    targetY: pointer.y,
    targetPosition,
  })
  return { path, sourceX, sourceY, targetX: pointer.x, targetY: pointer.y }
}
