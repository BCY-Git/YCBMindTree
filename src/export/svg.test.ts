import { describe, expect, it } from 'vitest'
import { executeCommand } from '../domain/commands'
import { createInitialDocument } from '../domain/document.factory'
import { exportDocumentSvg } from './svg'

describe('SVG visual export', () => {
  it('exports the complete visible hierarchy independently of the viewport', () => {
    const document = createInitialDocument()
    const svg = exportDocumentSvg(document)
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml')

    expect(xml.querySelector('parsererror')).toBeNull()
    expect(xml.documentElement.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/)
    expect(xml.querySelectorAll('[data-node-id]')).toHaveLength(4)
    expect(xml.querySelectorAll('[data-tree-edge]')).toHaveLength(3)
    expect(svg).toContain('按 Tab 创建子节点')
    expect(svg).toContain('#f5f5ef')
  })

  it('omits collapsed descendants but includes cross-node relations and labels', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const childId = document.nodes[branchId].childIds[0]
    const related = executeCommand(document, { type: 'CREATE_RELATION', sourceId: document.rootId, targetId: childId, label: '验证' }).document
    const svgWithRelation = exportDocumentSvg(related, { transparent: true })
    expect(svgWithRelation).toContain('data-relation-edge')
    expect(svgWithRelation).toContain('验证')
    expect(svgWithRelation).not.toContain('<rect width="100%" height="100%"')

    const collapsed = executeCommand(related, { type: 'TOGGLE_COLLAPSE', nodeId: branchId }).document
    const collapsedSvg = exportDocumentSvg(collapsed)
    expect(collapsedSvg).not.toContain('按 Tab 创建子节点')
    expect(collapsedSvg).not.toContain('data-relation-edge')
  })
})
