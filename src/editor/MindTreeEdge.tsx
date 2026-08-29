import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react'
import { getMindTreePath } from './tree-edge'

export type MindTreeEdgeData = {
  fromRoot: boolean
}

type MindTreeFlowEdge = Edge<MindTreeEdgeData, 'mindTree'>

/** Drawnix/Plait 风格的主树枝，同时保留 React Flow 的命中区域和视口行为。 */
export function MindTreeEdge({ id, sourceX, sourceY, targetX, targetY, data, style }: EdgeProps<MindTreeFlowEdge>) {
  const path = getMindTreePath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    fromRoot: data?.fromRoot ?? false,
  })

  return <BaseEdge
    id={id}
    path={path}
    interactionWidth={20}
    className="mind-tree-edge__path"
    style={{
      ...style,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }}
  />
}
