import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { layoutTree } from './tree-layout'

describe('tree layout', () => {
  it('keeps children to the right and preserves sibling order', () => {
    const document = createInitialDocument()
    const nodes = layoutTree(document)
    const byId = Object.fromEntries(nodes.map((node) => [node.id, node]))
    const branchId = document.nodes[document.rootId].childIds[0]
    const [firstChild, secondChild] = document.nodes[branchId].childIds

    expect(byId[branchId].x).toBeGreaterThan(byId[document.rootId].x)
    expect(byId[firstChild].y).toBeLessThan(byId[secondChild].y)
  })

  it('does not render descendants of a collapsed node', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    document.nodes[branchId].collapsed = true

    const ids = layoutTree(document).map((node) => node.id)
    expect(ids).toContain(branchId)
    document.nodes[branchId].childIds.forEach((id) => expect(ids).not.toContain(id))
  })
})
