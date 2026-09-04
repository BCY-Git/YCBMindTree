import { describe, expect, it } from 'vitest'
import { buildWorkspaceTools } from '../src/workspace-agent.js'
import { requiresApproval } from '../src/tools.js'

/**
 * 这份测试守的是"把 DeepAgents 关进笼子"这条边界本身，不是 DeepAgents 会不会
 * 正确运行（那是 deepagents 自己的职责，不该我们重新测）。所以不构造完整的
 * agent、不需要真实模型——只断言"注册进去的工具集合，形状对不对"。
 */
describe('buildWorkspaceTools：工具边界', () => {
  it('只注册了只读检索和候选提案两个工具，没有第三个', async () => {
    const tools = buildWorkspaceTools(async () => [])
    expect(tools.map((t) => t.name).sort()).toEqual(['propose_cross_document_link', 'search_workspace_documents'])
  })

  it('工具集合里没有任何名字暗示"直接写入/修改/删除"的工具——这是防回归断言：', () => {
    const tools = buildWorkspaceTools(async () => [])
    const forbiddenPatterns = /^(write|update|delete|create|apply|commit)_/i
    for (const t of tools) {
      expect(t.name).not.toMatch(forbiddenPatterns)
    }
  })

  it('每个工具要么是只读（不需要审批），要么是 propose_ 前缀（需要审批）——没有第三种灰色地带', () => {
    const tools = buildWorkspaceTools(async () => [])
    for (const t of tools) {
      const needsApproval = requiresApproval(t.name)
      // search_workspace_documents 不需要审批；propose_cross_document_link 需要。
      if (t.name === 'search_workspace_documents') expect(needsApproval).toBe(false)
      else expect(needsApproval).toBe(true)
    }
  })

  it('search_workspace_documents 只读：调用它不会触发任何写操作，只是把注入的检索函数结果原样透传', async () => {
    const tools = buildWorkspaceTools(async (query) => [{ documentId: 'd1', documentTitle: '周报', topic: query, snippet: '...' }])
    const searchTool = tools.find((t) => t.name === 'search_workspace_documents')!
    const result = JSON.parse((await searchTool.invoke({ query: 'AFSIM' })) as string)
    expect(result).toEqual([{ documentId: 'd1', documentTitle: '周报', topic: 'AFSIM', snippet: '...' }])
  })

  it('propose_cross_document_link 只返回候选描述，不做任何实际关联动作', async () => {
    const tools = buildWorkspaceTools(async () => [])
    const proposeTool = tools.find((t) => t.name === 'propose_cross_document_link')!
    const result = JSON.parse(
      (await proposeTool.invoke({
        sourceDocumentId: 'd1', sourceNodeId: 'n1', targetDocumentId: 'd2', targetNodeId: 'n2', reason: '主题相关',
      })) as string,
    )
    expect(result.kind).toBe('cross-link-proposal')
  })
})
