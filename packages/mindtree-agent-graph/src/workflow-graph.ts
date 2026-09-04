/**
 * 智能协作状态机：循环边示范。
 *
 * 对照 src/ai/workflow/workflow-types.ts 的 WorkflowPhase 联合类型和
 * docs/mindtree-agent-design-v0.3/06-agent-architecture.md 第 6-8 节。
 * 你的类型定义已经描述好了"形状"，这里补的是"怎么在阶段之间移动"，
 * 尤其是"验证没通过，退回建模"这种 WorkflowPanel.tsx 现在的命令式代码
 * 没有方便实现的循环。
 */
import { Annotation, StateGraph, START, END } from '@langchain/langgraph'

export const WorkflowState = Annotation.Root({
  mode: Annotation<'explore' | 'decide' | 'deliver'>({ reducer: (_c, u) => u, default: () => 'explore' }),
  phase: Annotation<string>({ reducer: (_c, u) => u, default: () => 'context' }),
  checkpoints: Annotation<Array<{ phase: string; openQuestions: string[] }>>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  // validation 节点置位，routeAfterValidation 读它决定走向——这是循环的触发条件，
  // 单独放成一个 boolean channel 而不是塞进 phase 字符串里判断，是为了让路由函数
  // 保持"只读一个字段就能决定"的简单形态，方便单测。
  needsReModeling: Annotation<boolean>({ reducer: (_c, u) => u, default: () => false }),
})
export type WorkflowStateType = typeof WorkflowState.State

export type ValidationChecker = (state: WorkflowStateType) => Promise<boolean>

export function createWorkflowGraph({ checkValidation }: { checkValidation: ValidationChecker }) {
  async function understandingNode(): Promise<Partial<WorkflowStateType>> {
    return { phase: 'understanding' }
  }
  async function modelingNode(): Promise<Partial<WorkflowStateType>> {
    return { phase: 'modeling', needsReModeling: false }
  }
  async function validationNode(state: WorkflowStateType): Promise<Partial<WorkflowStateType>> {
    const stillUnclear = await checkValidation(state)
    return { phase: 'validation', needsReModeling: stillUnclear }
  }
  async function criteriaNode(): Promise<Partial<WorkflowStateType>> {
    return { phase: 'criteria' }
  }

  function routeAfterValidation(state: WorkflowStateType): 'modeling' | 'criteria' {
    return state.needsReModeling ? 'modeling' : 'criteria' // ← 循环边
  }

  return new StateGraph(WorkflowState)
    .addNode('understanding', understandingNode)
    .addNode('modeling', modelingNode)
    .addNode('validation', validationNode)
    .addNode('criteria', criteriaNode)
    .addEdge(START, 'understanding')
    .addEdge('understanding', 'modeling')
    .addEdge('modeling', 'validation')
    .addConditionalEdges('validation', routeAfterValidation, ['modeling', 'criteria'])
    .addEdge('criteria', END)
    .compile()
}

// 「探索 / 决策 / 交付不需要经过同样步骤」（文档第 6 节）：不建议一张图塞三种
// mode 的所有节点再用超长 if 路由，那样会变成新的意大利面。更接近文档意图的
// 做法是三张小图（decide/deliver 图结构类似，自行仿照上面这份写），每种 mode
// 各自的循环边不会互相污染；顶层由一个"模式识别"节点（或直接读 state.mode）
// 决定进哪张子图，LangGraph 支持把编译好的图当一个节点嵌进另一张图。
