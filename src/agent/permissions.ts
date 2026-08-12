import type { AgentTool } from '@/agent/types'

export interface PermissionDecision {//允许的决定
  allowed: boolean
  producesCandidate?: boolean
  reason?: string
}

/**
 * 集中式审批策略：任何工具执行前都必须经过这里。
 * 写入/删除类工具不存在，因此这里没有“自动写入”分支。
 */
export function evaluateToolPermission(tool: AgentTool | undefined): PermissionDecision {
  if (!tool) return { allowed: false, reason: '模型请求了未注册的工具' }
  if (tool.category === 'proposal') return { allowed: true, producesCandidate: true }
  return { allowed: true }
}