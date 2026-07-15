import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../../domain/document.factory'
import { buildDepositContext } from './deposit-context'

describe('deposit context', () => {
  it('uses the selected subtree as source but exposes current-document targets', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const context = buildDepositContext(document, branchId, ['old-fingerprint'])

    expect(context.source.selectedNodeIds).toEqual([branchId])
    expect(context.source.nodes.map((node) => node.id)).toContain(branchId)
    expect(context.source.nodes.map((node) => node.id)).not.toContain(document.rootId)
    expect(context.destinations[0].candidateNodes).toHaveLength(Object.keys(document.nodes).length)
    expect(context.alreadyAppliedFingerprints).toEqual(['old-fingerprint'])
  })
})
