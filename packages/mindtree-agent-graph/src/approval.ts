/**
 * 候选审批：类型 + 纯函数部分。
 *
 * 注意这个文件里没有 `interrupt()` 调用——interrupt() 是运行时行为（暂停整张图、
 * 依赖 checkpointer），没法脱离一个正在跑的图单独做有意义的单测，所以真正调用
 * interrupt() 的地方在 graph.ts 里，用集成测试（跑一遍图 + resume）验证。
 * 这里只放"跟 interrupt() 无关、可以独立验证"的部分：决策类型、payload 怎么组装。
 *
 * 设计取舍：一次性把整批候选交给 interrupt()，而不是每个候选调一次 interrupt()。
 * 原因：LangGraph 的节点在 resume 之后是"从函数开头重新执行"的——如果在一个循环
 * 里对多个候选分别调用 interrupt()，第一次 resume 时前面已经 resolve 的
 * interrupt() 会立刻拿到缓存值继续跑，但循环体里 interrupt() 之前的副作用
 * （比如提前 applyCandidate）会被重新执行一遍，容易埋雷。批量 interrupt 只在
 * 节点里出现一次调用点，不存在这个问题，也更贴近你产品「批量确认选中项」的
 * 实际交互（DepositInbox 一次性展示一批候选，而不是逐条弹窗）。
 */
import type { CandidateProposal } from './state.js'

export type ApprovalDecision =
  | { action: 'accept'; edits?: Record<string, unknown> }
  | { action: 'reject' }

export type BatchApprovalDecisions = Record<string /* candidateId */, ApprovalDecision>

export type CandidateReviewPayload = {
  type: 'candidate-batch-review'
  candidates: CandidateProposal[]
}

/** 组装要交给 interrupt() 的 payload——纯函数，方便单测覆盖"哪些候选真的需要审批"这条边界。 */
export function buildBatchReviewPayload(candidates: CandidateProposal[]): CandidateReviewPayload {
  return { type: 'candidate-batch-review', candidates }
}

/** resume 时前端可能没有覆盖到的候选（比如用户没点它就关闭了面板），默认按"忽略"处理，不能默认接受。 */
export function resolveDecision(decisions: BatchApprovalDecisions, candidateId: string): ApprovalDecision {
  return decisions[candidateId] ?? { action: 'reject' }
}
