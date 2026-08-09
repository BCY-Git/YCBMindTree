import type { WorkflowMode, WorkflowSession } from './workflow-types'
import { randomUuid } from '../../platform/random-uuid'

export function inferWorkflowMode(prompt: string): WorkflowMode {
  const value = prompt.toLocaleLowerCase()
  if (/(选哪个|选择|比较|取舍|权衡|决策|方案)/.test(value)) return 'decide'
  if (/(实现|修改|生成|完成|交付|开发|制作)/.test(value)) return 'deliver'
  return 'explore'
}

export function createWorkflowSession(documentId: string, focusNodeId: string, goal: string, mode = inferWorkflowMode(goal)): WorkflowSession {
  const now = Date.now()
  return { id: randomUuid(), documentId, focusNodeId, mode, phase: 'context', status: 'active', goal: goal.trim(), audience: '', deliverable: '', constraints: [], acceptanceCriteria: [], confirmedFacts: [], rejectedOptions: [], openQuestions: [], nextActions: [], checkpoints: [], createdAt: now, updatedAt: now, completedAt: null }
}

export const workflowCheckpointPrompt = `你是 MindTree 的阶段检查点助手。根据协作状态、焦点子树和用户最近输入，提取已经稳定的信息，不要编造。只返回合法 JSON：{"confirmed":["已确认"],"rejected":["已排除"],"constraints":["当前约束"],"openQuestions":["待确认"],"nextActions":["下一步"]}。每项最多 20 条，没有则返回空数组。`
