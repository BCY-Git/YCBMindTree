import { describe, expect, it } from 'vitest'
import { createReadFocusSubtreeTool, proposeCreateNode, requiresApproval } from '../src/tools.js'

describe('requiresApproval：审批边界判断', () => {
  it('propose_ 前缀的工具需要审批', () => {
    expect(requiresApproval('propose_create_node')).toBe(true)
    expect(requiresApproval('propose_cross_document_link')).toBe(true)
  })

  it('非 propose_ 前缀（只读工具）不需要审批', () => {
    expect(requiresApproval('read_focus_subtree')).toBe(false)
    expect(requiresApproval('search_workspace_documents')).toBe(false)
  })
})

describe('proposeCreateNode：只生成候选描述，不接触任何真实数据源', () => {
  it('返回的内容是描述性 JSON，不是"已执行"的确认', async () => {
    const result = await proposeCreateNode.invoke({ parentId: 'n1', topic: '新想法', taskStatus: 'todo' })
    const parsed = JSON.parse(result as string)
    expect(parsed).toEqual({ kind: 'create-node', parentId: 'n1', topic: '新想法', taskStatus: 'todo' })
  })

  it('taskStatus 未提供时默认为 none（schema 默认值生效）', async () => {
    const result = await proposeCreateNode.invoke({ parentId: 'n1', topic: '新想法' })
    expect(JSON.parse(result as string).taskStatus).toBe('none')
  })
})

describe('createReadFocusSubtreeTool：数据访问通过注入，不是包自己硬编码的', () => {
  it('调用时把 nodeId 转交给注入的 loadSubtree，并透传其返回值', async () => {
    const calls: string[] = []
    const readTool = createReadFocusSubtreeTool(async (nodeId) => {
      calls.push(nodeId)
      return { id: nodeId, topic: '子树根' }
    })
    const result = await readTool.invoke({ nodeId: 'n42' })
    expect(calls).toEqual(['n42'])
    expect(JSON.parse(result as string)).toEqual({ id: 'n42', topic: '子树根' })
  })
})
