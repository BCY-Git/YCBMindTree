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

  it('preserves relation curve, color and line style in SVG exports', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const childId = document.nodes[branchId].childIds[0]
    const created = executeCommand(document, { type: 'CREATE_RELATION', sourceId: document.rootId, targetId: childId, label: '依赖' }).document
    const relationId = created.relations[0].id
    const styled = executeCommand(created, { type: 'UPDATE_RELATION_STYLE', relationId, patch: { lineStyle: 'solid', color: '#c15f48', controlOffsetX: 38, controlOffsetY: -26 } }).document

    const svg = exportDocumentSvg(styled)

    expect(svg).toContain('stroke="#c15f48"')
    expect(svg).toContain(`id="relation-arrow-${relationId}"`)
    expect(svg).not.toContain('stroke-dasharray="9 7"')
    expect(svg).toContain(' Q ')
  })

  it('embeds an available local image inside its reserved node thumbnail area', () => {
    const document = createInitialDocument()
    const nodeId = document.nodes[document.rootId].childIds[0]
    document.nodes[nodeId].attachments.push({ id: 'image-1', name: '示意图.png', type: 'image/png', size: 8, createdAt: 1 })

    const svg = exportDocumentSvg(document, { images: { 'image-1': 'data:image/png;base64,aW1hZ2U=' } })

    expect(svg).toContain('data-attachment-id="image-1"')
    expect(svg).toContain('href="data:image/png;base64,aW1hZ2U="')
  })
})
