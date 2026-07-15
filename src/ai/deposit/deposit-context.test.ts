import { describe, expect, it } from 'vitest'
import { createInitialDocument, createNode } from '../../domain/document.factory'
import { buildDepositContext, depositContextLimits } from './deposit-context'

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

  it('caps large source subtrees and destination lists while reporting the actual range', () => {
    const document = createInitialDocument()
    const root = document.nodes[document.rootId]
    for (let index = 0; index < depositContextLimits.destinationNodes + 20; index += 1) {
      const node = createNode(`记录 ${index}`, root.id)
      root.childIds.push(node.id)
      document.nodes[node.id] = node
    }
    const context = buildDepositContext(document, document.rootId, [])

    expect(context.source.nodes).toHaveLength(depositContextLimits.sourceNodes)
    expect(context.source).toMatchObject({ truncated: true, totalNodeCount: Object.keys(document.nodes).length })
    expect(context.destinations[0].candidateNodes).toHaveLength(depositContextLimits.destinationNodesPerDocument)
    expect(context.destinations[0].truncated).toBe(true)
  })

  it('offers a bounded set of recent workspace documents as destinations', () => {
    const source = createInitialDocument()
    const other = createInitialDocument()
    other.title = '无人项目'
    const context = buildDepositContext(source, source.rootId, [], [source, other])

    expect(context.destinations.map((item) => item.documentId)).toEqual([source.id, other.id])
  })
})
