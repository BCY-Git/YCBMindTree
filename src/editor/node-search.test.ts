import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { searchNodes } from './node-search'

describe('node search', () => {
  it('searches topics, notes and link metadata while returning the node path', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const noteNodeId = document.nodes[branchId].childIds[0]
    const linkNodeId = document.nodes[branchId].childIds[1]
    document.nodes[noteNodeId].note = '会议结论：下周完成验收'
    document.nodes[linkNodeId].links = [{ id: 'docs', label: '设计文档', url: 'https://example.com/design' }]

    expect(searchNodes(document, '验收')[0]).toMatchObject({ nodeId: noteNodeId, matchedIn: ['note'] })
    expect(searchNodes(document, '设计文档')[0]).toMatchObject({ nodeId: linkNodeId, matchedIn: ['link'] })
    expect(searchNodes(document, '从这里开始')[0]?.path).toContain('我的思维导图 / 从这里开始')
  })
})
