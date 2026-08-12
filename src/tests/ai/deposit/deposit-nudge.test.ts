import { describe, expect, it } from 'vitest'
import { createInitialDocument, createNode, createQuickNoteDocument } from '@/domain/document.factory'
import { depositNudgeReason, disableDepositNudges, shouldShowDepositNudge, snoozeDepositNudge } from '@/ai/deposit/deposit-nudge'

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

  it('lets the user defer a nudge for a day without disabling it permanently', () => {
    const now = 1_000_000
    snoozeDepositNudge('daily-document', now)
    expect(shouldShowDepositNudge('daily-document', now + 23 * 60 * 60 * 1_000)).toBe(false)
    expect(shouldShowDepositNudge('daily-document', now + 24 * 60 * 60 * 1_000)).toBe(true)
  })

  it('can disable nudges only for the current document', () => {
    disableDepositNudges('quiet-document')
    expect(shouldShowDepositNudge('quiet-document')).toBe(false)
    expect(shouldShowDepositNudge('another-document')).toBe(true)
  })
  
})
