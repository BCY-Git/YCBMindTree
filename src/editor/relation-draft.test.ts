import { describe, expect, it } from 'vitest'
import { relationDraftGeometry, relationTopicPositionAt } from './relation-draft'

describe('relation draft geometry', () => {
  it('centers a newly created relation topic on the double-click position', () => {
    expect(relationTopicPositionAt({ x: 420, y: 260 })).toEqual({ x: 361, y: 238 })
  })

  it('starts the preview at the relation handle and ends at the pointer', () => {
    const geometry = relationDraftGeometry({ x: 100, y: 80, width: 160, height: 50 }, { x: 420, y: 210 })

    expect(geometry).toMatchObject({ sourceX: 265, sourceY: 94, targetX: 420, targetY: 210 })
    expect(geometry.path).toContain('420,210')
  })
})
