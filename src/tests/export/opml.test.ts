import { describe, expect, it } from 'vitest'
import { executeCommand } from '@/domain/commands'
import { createInitialDocument } from '@/domain/document.factory'
import { exportOpml, parseOpml } from '@/export/opml'

describe('OPML interoperability', () => {
  it('round-trips hierarchy, order, notes and collapsed state', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const noted = executeCommand(document, { type: 'UPDATE_NODE_NOTE', nodeId: branchId, note: '保留这条背景\n以及第二行' }).document
    const collapsed = executeCommand(noted, { type: 'TOGGLE_COLLAPSE', nodeId: branchId }).document

    const imported = parseOpml(exportOpml(collapsed), 'fallback.opml')
    const importedRoot = imported.document.nodes[imported.document.rootId]
    const importedBranch = imported.document.nodes[importedRoot.childIds[0]]

    expect(imported.document.title).toBe(document.title)
    expect(importedRoot.topic).toBe('我的思维导图')
    expect(importedBranch.topic).toBe('从这里开始')
    expect(importedBranch.note).toBe('保留这条背景\n以及第二行')
    expect(importedBranch.collapsed).toBe(true)
    expect(importedBranch.childIds.map((id) => imported.document.nodes[id].topic)).toEqual(['按 Tab 创建子节点', '按 Enter 创建同级节点'])
    expect(imported.summary).toEqual({ nodeCount: 4, maxDepth: 3 })
  })

  it('wraps multiple top-level outlines under the OPML title', () => {
    const imported = parseOpml(`<?xml version="1.0"?><opml version="2.0"><head><title>迁移计划</title></head><body><outline text="准备"/><outline text="执行"/></body></opml>`, 'fallback.opml')
    const root = imported.document.nodes[imported.document.rootId]

    expect(root.topic).toBe('迁移计划')
    expect(root.childIds.map((id) => imported.document.nodes[id].topic)).toEqual(['准备', '执行'])
  })

  it('rejects malformed XML and empty outlines without producing a document', () => {
    expect(() => parseOpml('<opml><body><outline></body></opml>', 'broken.opml')).toThrow('OPML XML 格式无效')
    expect(() => parseOpml('<opml version="2.0"><head/><body/></opml>', 'empty.opml')).toThrow('OPML 中没有可导入的大纲')
  })
})
