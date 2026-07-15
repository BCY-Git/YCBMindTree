import { describe, expect, it } from 'vitest'
import { createInitialDocument, createNode, createQuickNoteDocument } from '../../domain/document.factory'
import { depositNudgeReason } from './deposit-nudge'

describe('deposit nudge', () => {
  it('suggests locally after a quick note develops multiple themes', () => {
    const document = createQuickNoteDocument()
    for (const topic of ['想法一', '想法二']) {
      const child = createNode(topic, document.rootId)
      document.nodes[document.rootId].childIds.push(child.id)
      document.nodes[child.id] = child
    }
    expect(depositNudgeReason(document, document.rootId)).toContain('随手记')
  })

  it('stays quiet for an ordinary small branch', () => {
    const document = createInitialDocument()
    expect(depositNudgeReason(document, document.nodes[document.rootId].childIds[0])).toBeNull()
  })
})
