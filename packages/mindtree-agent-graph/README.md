# @mindtree/agent-graph

MindTree AI 核心链路的图定义：候选生成、批量审批（`interrupt()`）、循环状态机、
可选的知识库调研 agent。纯逻辑包，不碰任何具体的 model provider、
checkpointer 后端或导图数据存储——这些全部由消费它的 app（`apps/mindtree-server`
或桌面前端）注入。

## 读的顺序

1. `src/state.ts` —— 共享 State 定义，对应「源上下文/路由上下文/历史上下文」三层策略
2. `src/tools.ts` —— `propose_*` 工具 + `requiresApproval()` 审批边界判断
3. `src/approval.ts` —— 候选审批的类型和纯函数部分（为什么不是逐条 `interrupt()`）
4. `src/graph.ts` —— 主图：`propose_candidates → review_candidates`，唯一的 `interrupt()` 调用点
5. `src/workflow-graph.ts` —— 循环边示范：explore/decide/deliver 状态机
6. `src/workspace-agent.ts` —— 独立子路径导出，只有"知识库"场景才需要

## 用法（示意）

```ts
import { createMindTreeGraph, proposeCreateNode, requiresApproval, createReadFocusSubtreeTool } from '@mindtree/agent-graph'
import { Command } from '@langchain/langgraph'

const graph = createMindTreeGraph({
  model,                 // 宿主选的 BaseChatModel 实现，包不关心是哪个 provider
  tools: [proposeCreateNode, createReadFocusSubtreeTool(loadSubtreeFromDomain)],
  checkpointer,          // Web 用 SqliteSaver；桌面用 Dexie 实现的自定义 saver
  applyCandidate,        // 真正调 domain/commands.ts 写导图的函数
})

const paused = await graph.invoke({ messages: [...] }, { configurable: { thread_id: documentId } })
// paused 里有 __interrupt__ 时，把 candidates 渲染成候选卡片给用户看

// 用户点了"预览并写入"之后：
await graph.invoke(new Command({ resume: decisions }), { configurable: { thread_id: documentId } })
```

知识库场景（可选）：

```ts
import { createWorkspaceResearchAgent } from '@mindtree/agent-graph/workspace-agent'
```

这个子路径需要额外安装 `deepagents`（它自己又会要求 `langchain` 作为 peer），
不用的场景完全不需要装这两个包——已经用 `peerDependenciesMeta.optional` 声明过。

## 关于"要不要一拖一测试"

结论：这份包里六个 `src` 文件，五个有对应的 `test/*.test.ts`，唯独 `index.ts`
没有——不是我刻意维持"1:1"这个数字，是恰好这五个文件都有真实的分支/合并逻辑，
`index.ts` 只是重新导出，测它等于测 TypeScript 的模块解析本身，没有意义。

判断要不要给一个文件配测试，用这个标准会比"文件数等于测试数"更耐用：
**这个文件里有没有"输入不同、输出就该不同"的分支或合并规则？** 有，就值得测；
纯声明、纯转发、纯类型定义，不值得。具体到这份包：

- `state.ts` 的 reducer（`appendMessages`/`mergeFingerprints`）：合并规则错了，
  数据会悄悄丢，值得测，而且刻意没有伸手进 `MindTreeState.spec.xxx` 断言内部
  字段（LangGraph 内部实现细节，换版本就碎），改成测具名导出函数本身。
- `tools.ts` 的 `requiresApproval`：这是"候选制"这条产品红线的判断依据，
  错一次就是全线失守，必须测。
- `approval.ts` 的 `resolveDecision`：默认值该是 reject 还是 accept，这行为
  错了会导致用户没表态的候选被静默写入，是安全默认值，必须测。
- `graph.ts`：全包最重要的一份测试，不是单测，是集成测试——起一张真图、
  真的触发 `interrupt()`、真的用 `Command({ resume })` 恢复，断言"只有
  accept 的候选才会调用 applyCandidate"。这条路径涉及好几个模块协作，
  单独测每个模块都通过不代表组合起来是对的。
- `workflow-graph.ts` 的循环边：不测的话，"验证不通过退回建模"这条路径
  可能悄悄退化成一条直线（比如未来有人重构条件边时手滑），测试能在它
  发生的当下就炸，而不是等到某次协作会话真的卡死才发现。
- `workspace-agent.ts` 的工具边界：这份测试守的不是"DeepAgents 能不能跑"
  （那是 deepagents 自己的职责），是"我们注册进去的工具集合里绝对没有
  一个真正的写权限"——这是防止未来有人手滑往 `tools` 数组里加一个
  `write_xxx` 的回归测试。

如果以后往这个包里加文件，用上面那条标准判断要不要配测试，比机械地保持
"一个源文件一个测试文件"更可靠——真正的目标是"分支和边界都被断言过"，
不是数字对齐。

## 两个真实踩过的坑（写下来省得你重新踩）

1. **`FakeStreamingChatModel` 的非流式 `_generate()` 只认 `chunks[0].tool_calls`，
   不认 `responses[0].tool_calls`**（`content` 反过来只认 `responses[0]`）。
   写测试构造假模型返回 `tool_calls` 时，用 `chunks: [new AIMessageChunk({ tool_calls: [...] })]`，
   不要用 `responses`，否则 `graph.invoke()` 里 `state.pendingCandidates` 永远是空的，
   会误以为自己的图逻辑写错了。
2. **`graph.invoke()` 暂停时返回值里真的有 `__interrupt__` 字段
   （`[{ id, value }]`），但当前 langgraph.js 版本的 TS 类型声明没有把它
   写进 `invoke()` 的返回类型**——这是库的类型声明缺口。测试里没有到处
   撒 `as any`，而是收敛成 `test/graph.test.ts` 顶部一个具名的
   `InterruptEnvelope` 类型 + `readInterruptValue()`/`hasInterrupted()`
   两个读取函数，其余断言保持强类型。

## 已验证

`npx tsc --noEmit`、`npx vitest run`（22 个测试全过）、`npx tsdown ...`（产物
`index.mjs` 10KB、`workspace-agent.mjs` 3KB，`deepagents`/`langchain` 正确
外部化没有被打进 bundle）都在真实的 `@langchain/core@1.2.9` /
`@langchain/langgraph@1.4.13` / `deepagents@1.13.2` 版本上跑过一遍，不是
凭空写的示意代码。

## 还没做、留给你接进 apps 的部分

这次按你的要求只切了 `packages/mindtree-agent-graph` 这一个包本身。
`apps/mindtree-server` 里接一条真正的 agent 路由（换掉 `ai-proxy.ts` 的纯转发）、
桌面端接一个 Dexie 实现的 checkpointer——这两块之前讨论过设计，但还没有
落成代码，你练熟这个包之后我们可以再对着接。
