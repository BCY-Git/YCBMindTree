/**
 * 共享 State 定义。
 *
 * 对应 docs/mindtree-agent-design-v0.3/06-agent-architecture.md 第 3 节
 * 「源上下文 / 路由上下文 / 历史上下文」——这里把那份自然语言规格翻译成
 * 一份带 reducer 的 State schema。每个 channel 显式声明"新旧值怎么合并"，
 * 这是 Annotation 相对普通 interface 多做的事。
 *
 * 写法上的一个小选择：reducer 都提成下面这几个具名导出函数，不是直接
 * 内联匿名箭头函数塞进 Annotation() 调用里。原因是 Annotation.Root() 在
 * 运行时会把配置包装成 LangGraph 自己的 channel 对象（BinaryOperatorAggregate
 * 之类），字段名是 `operator`/`initialValueFactory`，跟你写的时候用的
 * `reducer`/`default` 不是一回事——直接伸手进 MindTreeState.spec.xxx 里
 * 断言 reducer 行为，测试会绑死在 LangGraph 的内部实现细节上，它换个
 * 内部字段名你的测试就全挂了。提成具名函数之后，测试直接 import 这些
 * 函数本身，跟 LangGraph 的内部结构完全无关。
 */
import { Annotation } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'

export type CandidateProposal = {
  id: string
  toolName: string
  payload: Record<string, unknown>
}

export type FocusContext = {
  documentId: string
  rootNodeId: string
  nodesJson: string
}

export type RetrievedSource = {
  documentId: string
  documentTitle: string
  topic: string
}

/** messages：追加语义。取代 AiAssistant.tsx 里 setResponse(next) 的整块替换。 */
export function appendMessages(current: BaseMessage[], update: BaseMessage[]): BaseMessage[] {
  return current.concat(update)
}

/** 「历史上下文」：已应用指纹去重集合。追加 + 去重语义。 */
export function mergeFingerprints(current: string[], update: string[]): string[] {
  return Array.from(new Set([...current, ...update]))
}

/** 替换语义的公共实现：focusContext / retrievedSources / pendingCandidates 都是"每轮整体替换"。 */
function replaceValue<T>(_current: T, update: T): T {
  return update
}

export const MindTreeState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: appendMessages, default: () => [] }),

  // 「源上下文」：当前节点/子树。每次分析都是新的 focus，不需要跟旧值合并。
  focusContext: Annotation<FocusContext | null>({ reducer: replaceValue, default: () => null }),

  // 「路由上下文」：候选目标文档与节点（跨文档检索结果）。
  retrievedSources: Annotation<RetrievedSource[]>({ reducer: replaceValue, default: () => [] }),

  appliedFingerprints: Annotation<string[]>({ reducer: mergeFingerprints, default: () => [] }),

  // 模型生成、尚未经用户确认的候选。替换语义：每一轮 propose 都是新的一批。
  pendingCandidates: Annotation<CandidateProposal[]>({ reducer: replaceValue, default: () => [] }),
})

export type MindTreeStateType = typeof MindTreeState.State
export type MindTreeUpdateType = typeof MindTreeState.Update
