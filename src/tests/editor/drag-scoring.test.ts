import { describe, expect, it } from 'vitest'
import { chooseBestTreeDropCandidate, scoreChildDropCandidate, scoreSiblingDropCandidate } from '@/editor/drag-scoring'

const dragged = { x: 120, y: 100, width: 100, height: 48 }

describe('drag drop candidate scoring', () => {
  it('chooses the closest eligible child target instead of the first rendered target', () => {
    const firstButFar = scoreChildDropCandidate({
      parentId: 'far', index: 0, target: { x: 250, y: 80, width: 160, height: 48 }, dragged, motion: { x: 1, y: 0 },
    })
    const laterButNear = scoreChildDropCandidate({
      parentId: 'near', index: 0, target: { x: 226, y: 100, width: 160, height: 48 }, dragged, motion: { x: 1, y: 0 },
    })

    expect(chooseBestTreeDropCandidate([firstButFar, laterButNear])?.parentId).toBe('near')
  })

  it('prefers a card directly under the dragged node over a merely nearby branch insertion line', () => {
    const child = scoreChildDropCandidate({
      parentId: 'target', index: 0, target: { x: 205, y: 96, width: 160, height: 56 }, dragged, motion: { x: 1, y: 0 },
    })
    const sibling = scoreSiblingDropCandidate({
      parentId: 'other-parent', index: 2, branchStart: { x: 190, y: 124 }, branchEnd: { x: 290, y: 124 }, dragged,
    })

    expect(chooseBestTreeDropCandidate([sibling, child])?.kind).toBe('child')
  })

  it('uses movement direction to break otherwise similar child targets', () => {
    const left = scoreChildDropCandidate({
      parentId: 'left', index: 0, target: { x: 24, y: 100, width: 96, height: 48 }, dragged, motion: { x: 80, y: 0 },
    })
    const right = scoreChildDropCandidate({
      parentId: 'right', index: 0, target: { x: 220, y: 100, width: 96, height: 48 }, dragged, motion: { x: 80, y: 0 },
    })

    expect(chooseBestTreeDropCandidate([left, right])?.parentId).toBe('right')
  })

  it('scales the child hot zone with node size', () => {
    const candidate = scoreChildDropCandidate({
      parentId: 'large-card', index: 0, target: { x: 300, y: 80, width: 420, height: 180 },
      dragged: { x: 120, y: 100, width: 120, height: 72 }, motion: { x: 1, y: 0 },
    })

    expect(candidate).not.toBeNull()
  })

  it('keeps scoring deterministic when candidates tie', () => {
    const first = { parentId: 'b', index: 0, kind: 'child' as const, score: 10 }
    const second = { parentId: 'a', index: 0, kind: 'child' as const, score: 10 }

    expect(chooseBestTreeDropCandidate([first, second])?.parentId).toBe('a')
  })
})
