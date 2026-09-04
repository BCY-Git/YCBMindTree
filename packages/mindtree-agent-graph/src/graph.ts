/**
 * 主图：一次"分析 → 生成候选 → 用户审批 → 落盘"的完整链路。
 *
 * 对照 AiAssistant.tsx 的 requestAssistant()：那里是一个函数里 if/else 出
 * 七八条业务线，各自拼提示词、各自解析、各自 setState。这里换成两个节点：
 * propose_candidates 只管"生成"，review_candidates 只管"审批+落盘"——
 * 图结构本身把"候选制"这条产品红线画了出来，不需要在业务代码里到处
 * 记着"这一步不能直接写"。
 *
 * 三个依赖全部通过参数注入，包本身不 import 任何具体的 model 实现、
 * 不 import better-sqlite3 或 Dexie，也不 import domain/commands.ts：
 *   - model：Web 端可能用服务器配置的 key，桌面端用用户本地填的 key，
 *     包不关心是哪个，只要求它是一个 BaseChatModel。
 *   - checkpointer：Web 用 SqliteSaver，桌面用 Dexie 实现的自定义 saver，
 *     包只要求它满足 BaseCheckpointSaver 接口。
 *   - applyCandidate：真正调 domain/commands.ts 写导图的函数，由宿主提供，
 *     包完全看不到导图数据结构，想误写都做不到。
 */
import { StateGraph, START, END, type BaseCheckpointSaver } from '@langchain/langgraph'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredTool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { randomUUID } from 'node:crypto'
import { MindTreeState, type MindTreeStateType, type CandidateProposal } from './state.js'
import { requiresApproval } from './tools.js'
import { buildBatchReviewPayload, resolveDecision, type BatchApprovalDecisions } from './approval.js'

export type MindTreeGraphDeps = {
  model: BaseChatModel
  tools: StructuredTool[]
  checkpointer: BaseCheckpointSaver
  applyCandidate: (candidate: CandidateProposal) => Promise<void>
}

export function createMindTreeGraph({ model, tools, checkpointer, applyCandidate }: MindTreeGraphDeps) {
  const modelWithTools = model.bindTools ? model.bindTools(tools) : model
  //生成候选
  async function proposeCandidates(state: MindTreeStateType): Promise<Partial<MindTreeStateType>> {
    const response = await modelWithTools.invoke(state.messages)
    const toolCalls = (response as { tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }> }).tool_calls ?? []
    const candidates: CandidateProposal[] = toolCalls.map((call) => ({
      id: call.id ?? randomUUID(),
      toolName: call.name,
      payload: call.args,
    }))
    return { messages: [response], pendingCandidates: candidates }
  }

  //审批候选
  async function reviewCandidates(state: MindTreeStateType): Promise<Partial<MindTreeStateType>> {
    const approvalRequired = state.pendingCandidates.filter((candidate) => requiresApproval(candidate.toolName))
    const autoApplied = state.pendingCandidates.filter((candidate) => !requiresApproval(candidate.toolName))

    // 只读工具（不需要审批的候选，理论上不该出现在这里，但防御性地处理一下）不阻塞流程。
    for (const candidate of autoApplied) await applyCandidate(candidate)

    if (approvalRequired.length === 0) return { pendingCandidates: [] }

    // 唯一一次 interrupt() 调用点：把整批候选一次性交给用户，
    // resume 时拿到的是「candidateId -> 决策」的映射。
    const decisions = interrupt(buildBatchReviewPayload(approvalRequired)) as BatchApprovalDecisions

    for (const candidate of approvalRequired) {
      const decision = resolveDecision(decisions, candidate.id)
      if (decision.action === 'accept') await applyCandidate(candidate)
    }
    return { pendingCandidates: [] }
  }

  return new StateGraph(MindTreeState)
    .addNode('propose_candidates', proposeCandidates)//生成候选
    .addNode('review_candidates', reviewCandidates)//审批候选
    .addEdge(START, 'propose_candidates')//开始 -> 生成候选
    .addEdge('propose_candidates', 'review_candidates')//生成候选 -> 审批候选
    .addEdge('review_candidates', END)//审批候选 -> 结束
    .compile({ checkpointer })
}
