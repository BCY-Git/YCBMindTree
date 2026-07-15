import { BaseEdge, type EdgeProps } from '@xyflow/react'
import { getTreeBranchPath } from './tree-edge'

export type TreeBranchEdgeData = { junctionX: number }

export function TreeBranchEdge({ id, sourceX, sourceY, targetX, targetY, data, style }: EdgeProps) {
  const junctionX = (data as TreeBranchEdgeData | undefined)?.junctionX ?? (sourceX + targetX) / 2
  return <BaseEdge id={id} path={getTreeBranchPath({ sourceX, sourceY, junctionX, targetX, targetY })} style={{ ...style, strokeLinecap: 'square', strokeLinejoin: 'miter' }} interactionWidth={12} />
}
