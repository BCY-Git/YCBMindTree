import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { BaseEdge, EdgeLabelRenderer, useReactFlow, type Edge, type EdgeProps } from '@xyflow/react'
import { relationControlForCurvePoint, relationControlPoint, relationDashArray, relationPath, type RelationLineStyle } from './relation-geometry'

export { relationControlForCurvePoint, relationControlPoint, relationDashArray, relationPath } from './relation-geometry'
export type { RelationLineStyle } from './relation-geometry'

export type RelationEdgeData = Record<string, unknown> & {
  label: string
  lineStyle: RelationLineStyle
  color: string
  controlOffsetX: number
  controlOffsetY: number
  opacity: number
  showLabel: boolean
  onSelect: (relationId: string) => void
  onLabelCommit: (relationId: string, label: string) => void
  onControlCommit: (relationId: string, offsetX: number, offsetY: number) => void
}

export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>

export function RelationEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, selected, data }: EdgeProps<RelationFlowEdge>) {
  const relation = data!
  const { screenToFlowPosition } = useReactFlow()
  const [draftOffset, setDraftOffset] = useState({ x: relation.controlOffsetX, y: relation.controlOffsetY })
  const [dragging, setDragging] = useState(false)
  const draftOffsetRef = useRef(draftOffset)
  const draggingRef = useRef(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(relation.label)
  const source = useMemo(() => ({ x: sourceX, y: sourceY }), [sourceX, sourceY])
  const target = useMemo(() => ({ x: targetX, y: targetY }), [targetX, targetY])
  const baseControl = useMemo(() => relationControlPoint(source, target), [source, target])
  const control = { x: baseControl.x + draftOffset.x, y: baseControl.y + draftOffset.y }
  const geometry = relationPath(source, target, control)

  useEffect(() => {
    if (!dragging) {
      const nextOffset = { x: relation.controlOffsetX, y: relation.controlOffsetY }
      draftOffsetRef.current = nextOffset
      setDraftOffset(nextOffset)
    }
  }, [dragging, relation.controlOffsetX, relation.controlOffsetY])
  useEffect(() => { if (!editingLabel) setLabelDraft(relation.label) }, [editingLabel, relation.label])

  const moveControl = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const nextControl = relationControlForCurvePoint(source, target, point)
    const nextOffset = { x: Math.round(nextControl.x - baseControl.x), y: Math.round(nextControl.y - baseControl.y) }
    draftOffsetRef.current = nextOffset
    setDraftOffset(nextOffset)
  }
  const commitControl = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    draggingRef.current = false
    setDragging(false)
    relation.onControlCommit(id, draftOffsetRef.current.x, draftOffsetRef.current.y)
  }
  const commitLabel = () => {
    relation.onLabelCommit(id, labelDraft)
    setEditingLabel(false)
  }

  return <>
    <BaseEdge
      id={id}
      path={geometry.path}
      markerEnd={markerEnd}
      interactionWidth={28}
      className={`relation-edge-path ${selected ? 'is-selected' : ''}`}
      style={{
        stroke: relation.color,
        strokeWidth: selected ? 2.8 : 1.9,
        strokeDasharray: relationDashArray(relation.lineStyle),
        strokeLinecap: 'round',
        opacity: relation.opacity,
      }}
    />
    <EdgeLabelRenderer>
      {(relation.showLabel || editingLabel) && <div
        className={`relation-edge-label nodrag nopan ${selected ? 'is-selected' : ''}`}
        style={{ transform: `translate(-50%, -50%) translate(${geometry.label.x}px, ${geometry.label.y}px)` }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {editingLabel
          ? <input
              autoFocus
              value={labelDraft}
              aria-label="关系名称"
              onChange={(event) => setLabelDraft(event.target.value)}
              onBlur={commitLabel}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') { event.preventDefault(); commitLabel() }
                if (event.key === 'Escape') { event.preventDefault(); setLabelDraft(relation.label); setEditingLabel(false) }
              }}
            />
          : <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                if (event.detail >= 2) { setEditingLabel(true); return }
                if (!selected) relation.onSelect(id)
              }}
              onDoubleClick={(event) => { event.stopPropagation(); setEditingLabel(true) }}
              title="双击编辑关系名称"
            >{relation.label}</button>}
      </div>}
      {selected && <button
        type="button"
        className={`relation-control-point nodrag nopan ${dragging ? 'is-dragging' : ''}`}
        style={{ transform: `translate(-50%, -50%) translate(${geometry.handle.x}px, ${geometry.handle.y}px)` }}
        aria-label="拖动关系线调整弧度"
        title="拖动关系线调整弧度"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          relation.onSelect(id)
          event.currentTarget.setPointerCapture(event.pointerId)
          draggingRef.current = true
          setDragging(true)
        }}
        onPointerMove={moveControl}
        onPointerUp={commitControl}
        onPointerCancel={commitControl}
      />}
    </EdgeLabelRenderer>
  </>
}
