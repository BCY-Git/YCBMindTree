import { describe, expect, it } from 'vitest'
import { parseMarkdownOutline } from './markdown-import'

describe('Markdown outline import', () => {
  it('turns headings and indented lists into hierarchy while keeping paragraphs as notes', () => {
    const imported = parseMarkdownOutline(`# 产品计划

## 目标
让记录可以再次被利用。

- 降低记录负担
  - 自动识别
- 保留用户确认

## 验收
- [ ] 导入前显示预览
- [x] 不覆盖当前导图`, '计划.md')
    const document = imported.document
    const root = document.nodes[document.rootId]
    const goal = document.nodes[root.childIds[0]]
    const firstGoal = document.nodes[goal.childIds[0]]
    const acceptance = document.nodes[root.childIds[1]]

    expect(document.title).toBe('产品计划')
    expect(root.topic).toBe('产品计划')
    expect(goal.topic).toBe('目标')
    expect(goal.note).toBe('让记录可以再次被利用。')
    expect(firstGoal.topic).toBe('降低记录负担')
    expect(document.nodes[firstGoal.childIds[0]].topic).toBe('自动识别')
    expect(document.nodes[acceptance.childIds[0]].taskStatus).toBe('todo')
    expect(document.nodes[acceptance.childIds[1]].taskStatus).toBe('done')
    expect(imported.summary).toEqual({ nodeCount: 8, maxDepth: 4 })
  })

  it('uses a single top-level list item as root and appends continuation paragraphs to its note', () => {
    const imported = parseMarkdownOutline(`- 学习 Agent
  一段补充说明
  - Tool Calling
  - JSON Schema`, '学习笔记.md')
    const root = imported.document.nodes[imported.document.rootId]

    expect(root.topic).toBe('学习 Agent')
    expect(root.note).toBe('一段补充说明')
    expect(root.childIds.map((id) => imported.document.nodes[id].topic)).toEqual(['Tool Calling', 'JSON Schema'])
  })

  it('rejects content without a usable heading or list', () => {
    expect(() => parseMarkdownOutline('只有一段散文，没有结构。', 'notes.md')).toThrow('Markdown 中没有可导入的标题或列表')
  })
})
