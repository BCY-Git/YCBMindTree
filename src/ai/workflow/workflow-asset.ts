import { z } from 'zod'
import type { MindNodeClipboard } from '../../domain/commands'
import { parseGeneratedBranch } from '../generated-branch'

export const workflowAssetKinds = ['decision-record', 'knowledge-card'] as const
export type WorkflowAssetKind = typeof workflowAssetKinds[number]

export const workflowAssetInstructions: Record<WorkflowAssetKind, string> = {
  'decision-record': '你是 MindTree 的决策记录助手。只提炼已经有依据的决策，不要编造。只返回合法 JSON，不要 Markdown 或解释。格式必须为：{"title":"决策主题","decision":"最终选择","reasons":["选择原因"],"alternatives":[{"name":"候选方案","rejectionReason":"未选择原因"}],"conditions":["适用条件"],"revisitTriggers":["重新评估条件"],"nextActions":["下一步"]}。没有内容的数组返回空数组。',
  'knowledge-card': '你是 MindTree 的知识卡助手。区分用户个人理解、标准定义和仍待验证的内容，不要编造。只返回合法 JSON，不要 Markdown 或解释。格式必须为：{"title":"概念名称","personalUnderstanding":"用户当前理解","definition":"准确的标准定义","boundaries":["关键边界"],"examples":["示例"],"misconceptions":["常见误区或已纠偏内容"],"openQuestions":["待验证问题"]}。没有内容的数组返回空数组。',
}

const text = z.string().trim().min(1).max(240)
const textList = z.array(text).max(20)

const decisionRecordSchema = z.object({
  title: text,
  decision: text,
  reasons: textList,
  alternatives: z.array(z.object({ name: text, rejectionReason: text })).max(12),
  conditions: textList,
  revisitTriggers: textList,
  nextActions: textList,
}).strict()

const knowledgeCardSchema = z.object({
  title: text,
  personalUnderstanding: text,
  definition: text,
  boundaries: textList,
  examples: textList,
  misconceptions: textList,
  openQuestions: textList,
}).strict()

function parseJson(content: string): unknown {
  return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
}

function node(topic: string, children: Array<{ topic: string; children: unknown[] }> = []) {
  return { topic, children }
}

function leaves(items: string[]) {
  return items.map((item) => node(item))
}

export function parseWorkflowAsset(content: string, kind: WorkflowAssetKind): MindNodeClipboard {
  const parsed = parseJson(content)
  if (kind === 'decision-record') {
    const value = decisionRecordSchema.parse(parsed)
    return parseGeneratedBranch(JSON.stringify(node(`决策记录：${value.title}`, [
      node('最终决策', leaves([value.decision])),
      node('选择原因', leaves(value.reasons)),
      node('候选与取舍', leaves(value.alternatives.map((item) => `${item.name}：${item.rejectionReason}`))),
      node('适用条件', leaves(value.conditions)),
      node('重新评估条件', leaves(value.revisitTriggers)),
      node('下一步', leaves(value.nextActions)),
    ])))
  }
  const value = knowledgeCardSchema.parse(parsed)
  return parseGeneratedBranch(JSON.stringify(node(`知识卡：${value.title}`, [
    node('我的理解', leaves([value.personalUnderstanding])),
    node('标准定义', leaves([value.definition])),
    node('关键边界', leaves(value.boundaries)),
    node('示例', leaves(value.examples)),
    node('常见误区', leaves(value.misconceptions)),
    node('待验证', leaves(value.openQuestions)),
  ])))
}
