import { describe, expect, it } from 'vitest'
import { executeCommand } from '@/domain/commands'
import { createInitialDocument } from '@/domain/document.factory'
import { exportMarkdown } from '@/export/markdown'

describe('Markdown export', () => {
  it('keeps the mind map hierarchy and node details in outline output', () => {
    const document = createInitialDocument()
    const childId = document.nodes[document.rootId].childIds[0]
    const withNote = executeCommand(document, { type: 'UPDATE_NODE_NOTE', nodeId: childId, note: '需要确认负责人' }).document
    const withLink = executeCommand(withNote, { type: 'ADD_NODE_LINK', nodeId: childId, url: 'https://example.com', label: '参考资料' }).document
    const markdown = exportMarkdown(withLink, 'outline')

    expect(markdown).toContain('- 我的思维导图')
    expect(markdown).toContain('  - 从这里开始')
    expect(markdown).toContain('> 需要确认负责人')
    expect(markdown).toContain('[参考资料](https://example.com/)')
  })

  it('creates a prompt-ready context format', () => {
    const markdown = exportMarkdown(createInitialDocument(), 'ai-context')

    expect(markdown).toContain('Use the following tree as source context')
    expect(markdown).toContain('## 我的思维导图 / 从这里开始')
  })

  it('exports marks, tags and a task-only checklist with path context', () => {
    const document = createInitialDocument()
    const nodeId = document.nodes[document.rootId].childIds[0]
    const semantic = executeCommand(document, { type: 'TOGGLE_NODE_MARK', nodeId, mark: 'idea' }).document
    const tagged = executeCommand(semantic, { type: 'SET_NODE_TAGS', nodeId, tagIds: ['work'] }).document
    const tasked = executeCommand(tagged, { type: 'SET_NODE_TASK_STATUS', nodeId, taskStatus: 'todo' }).document

    expect(exportMarkdown(tasked, 'outline')).toContain('[灵感] #work')
    expect(exportMarkdown(tasked, 'tasks')).toContain('- [ ] 我的思维导图 › 从这里开始')
  })
})
