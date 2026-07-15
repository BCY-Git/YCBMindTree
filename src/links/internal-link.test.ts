import { describe, expect, it } from 'vitest'
import { executeCommand } from '../domain/commands'
import { createInitialDocument } from '../domain/document.factory'
import { createInternalNodeLink, parseInternalNodeLink, resolveInternalNodeLink } from './internal-link'

describe('internal node links', () => {
  it('serializes only stable document and node identities', () => {
    const url = createInternalNodeLink('document 1', '节点/2')

    expect(url).toBe('mindtree://node?document=document+1&node=%E8%8A%82%E7%82%B9%2F2')
    expect(parseInternalNodeLink(url)).toEqual({ documentId: 'document 1', nodeId: '节点/2' })
    expect(parseInternalNodeLink('https://example.com')).toBeNull()
    expect(parseInternalNodeLink('mindtree://node?document=a')).toBeNull()
  })

  it('resolves live targets and identifies stale documents or nodes', () => {
    const document = createInitialDocument()
    const childId = document.nodes[document.rootId].childIds[0]

    expect(resolveInternalNodeLink(createInternalNodeLink(document.id, childId), [document])).toMatchObject({ status: 'ok', document, node: document.nodes[childId] })
    expect(resolveInternalNodeLink(createInternalNodeLink('missing', childId), [document])).toEqual({ status: 'missing-document' })
    expect(resolveInternalNodeLink(createInternalNodeLink(document.id, 'missing'), [document])).toEqual({ status: 'missing-node', document })
  })

  it('can be stored as a normal node resource without changing the document schema', () => {
    const document = createInitialDocument()
    const targetId = document.nodes[document.rootId].childIds[0]
    const linked = executeCommand(document, { type: 'ADD_NODE_LINK', nodeId: document.rootId, url: createInternalNodeLink(document.id, targetId), label: '前往分支' }).document

    expect(parseInternalNodeLink(linked.nodes[document.rootId].links[0].url)).toEqual({ documentId: document.id, nodeId: targetId })
  })
})
