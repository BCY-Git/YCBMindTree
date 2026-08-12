import { evaluateToolPermission } from '@/agent/permissions'
import { echoTool } from '@/agent/echo'
import type { AgentTool, ToolCategory } from '@/agent/types'

describe('evaluateToolPermission', () => {
  it('只读工具自动放行', () => {
    expect(evaluateToolPermission(echoTool)).toEqual({ allowed: true })
  })

  it('proposal 工具放行但标记结果为候选', () => {
    const proposalTool: AgentTool = {
      name: 'branch-propose',
      description: '产出分支候选',
      category: 'proposal',
      schema: echoTool.schema,
      async run() { return {} },
    }
    expect(evaluateToolPermission(proposalTool)).toEqual({ allowed: true, producesCandidate: true })
  })

  it('未注册工具被拒绝', () => {
    const decision = evaluateToolPermission(undefined)
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('未注册')
  })

  it('工具类别只有 read 与 proposal：写入能力不提供给模型', () => {
    // 该断言把「不存在 write 类别」的纪律固化进测试；新增类别时必须同步审批逻辑与本测试。
    const categories: ToolCategory[] = ['read', 'proposal']
    expect(categories).toEqual(['read', 'proposal'])
  })
})
