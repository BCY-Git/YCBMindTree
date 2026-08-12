# 第一课：从需求推导 Agent Harness 的 `types.ts`

## 1. 这一课要完成什么

这一课只设计和手写一个文件：

```text
src/agent/types.ts
```

它不调用模型、不执行工具，也不运行 Agent 循环。它只负责定义 Harness 内部模块之间共同使用的通信协议。

完成后，你应该能够回答：

1. Agent Loop、模型客户端和工具注册表之间传递什么数据？
2. 为什么内部类型不能直接使用 OpenAI SDK 类型？
3. 一次 Tool Call 和一次 Tool Execution 有什么区别？
4. 为什么工具参数先保留为字符串，之后才解析？
5. 为什么材料整理 Agent 没有 `write` 工具类别？
6. Agent 运行事件和 Agent 最终结果分别解决什么问题？

## 2. 项目需求背景

MindTree 已经能够让用户创建、编辑和保存思维导图。现在要增加一个“材料整理 Agent”：用户给它一个网页、文件或文件夹，Agent 自主读取资料，将内容整理成一棵思维树候选。

目标流程是：

```text
用户提出整理要求
  → 模型理解任务
  → 模型决定是否调用工具
  → Harness 执行网页或文件工具
  → 工具结果回填给模型
  → 模型根据新信息继续决策
  → 模型生成思维树候选
  → 用户预览和确认
  → MindTree 执行可撤销写入
```

这个流程不是一次普通的模型问答。它至少涉及：

- 模型客户端：负责请求具体模型服务。
- Agent Loop：负责多轮决策与终止。
- 工具系统：负责注册、校验和执行工具。
- 权限系统：负责判断某个工具是否允许执行。
- 上下文系统：负责控制消息和 Token 预算。
- Trace：负责记录 Agent 每一步做了什么。
- 业务层：负责把最终结果解释为 MindTree 思维树候选。

这些模块必须交换消息、Tool Call、工具执行结果、运行事件和最终状态。

如果没有统一的 `types.ts`，很容易出现下面的问题：

- 模型客户端返回 OpenAI 原始响应，Loop 被迫依赖供应商字段。
- Tool Registry 使用一种工具类型，Loop 又重新定义另一种工具类型。
- 工具错误有时抛异常，有时返回字符串，调用方无法统一处理。
- Trace 直接读取 Loop 内部变量，两个模块紧密耦合。
- 业务层无法判断 Agent 是正常完成、用户取消，还是预算耗尽。
- 更换模型供应商时，大量核心代码需要一起修改。

因此第一步不是急着写 `loop.ts`，而是先定义一套所有模块都认可的内部协议。

可以把 `types.ts` 理解为 Harness 内部的“接口合同”。合同先稳定，各模块才能独立实现、测试和替换。

## 3. `types.ts` 在架构中的位置

```text
                    ┌──────────────────┐
                    │  src/agent/types │
                    │   内部通信协议    │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
    model-client        tool-registry          loop
    模型协议适配          工具注册执行        多轮状态循环
          │                  │                  │
          └──────────────────┼──────────────────┘
                             ▼
                           trace
                         轨迹与审计
```

`types.ts` 可以被其他模块依赖，但它自身不应反过来依赖这些运行模块。

它只需要依赖 Zod 的类型，因为每个工具必须携带自己的参数 Schema。

## 4. 从业务流程一步步推导类型

### 4.1 用户和模型首先需要交换消息

一次 Agent 运行至少会出现四种消息：

```text
system     Harness 或业务层给模型的稳定规则
user       用户提出的材料整理任务
assistant  模型的文本回答或工具调用请求
tool       工具执行完成后回填给模型的观察
```

因此先得到：

```ts
type AgentRole = 'system' | 'user' | 'assistant' | 'tool'
```

然后需要一份内部消息结构：

```text
AgentMessage
├── role
├── content
├── toolCalls?    Assistant 可能携带
└── toolCallId?   Tool Message 用于关联调用
```

为什么 `content` 暂时只使用字符串？

因为第一版材料输入通过 `web-fetch`、`fs-read` 等工具读取，不直接把二进制文件或图片塞进 Message。这样可以先把文本 Agent Harness 做稳定，之后需要多模态时再扩展内容块类型。

### 4.2 模型需要表达“我要调用某个工具”

模型不会直接执行函数，它只会生成一条结构化请求，例如：

```json
{
  "id": "call_123",
  "name": "web-fetch",
  "arguments": "{\"url\":\"https://example.com\"}"
}
```

因此需要 `AgentToolCall`：

```text
AgentToolCall
├── id         关联后续 Tool Message
├── name       在注册表中查找具体工具
└── arguments  模型输出的原始 JSON 字符串
```

为什么 `arguments` 不直接定义成对象？

因为模型输出属于不可信输入。在到达 Tool Registry 之前，我们不能假设它：

- 一定是合法 JSON。
- 一定包含正确字段。
- 字段类型一定正确。
- 没有多余或危险参数。

保留原始字符串，可以明确划分安全边界：

```text
模型原始字符串
  → JSON.parse
  → Zod Schema 校验
  → 得到可信的工具参数
  → tool.run
```

### 4.3 Harness 需要统一描述工具

材料整理 Agent 后面会有：

- `web-fetch`：读取网页正文。
- `fs-list`：列出目录。
- `fs-read`：读取文本文件。
- `map-read`：读取当前思维导图。
- `branch-propose`：产出思维树候选。

这些工具的参数不同，但都需要共同信息：

```text
AgentTool<A>
├── name
├── description
├── category
├── schema
└── run(args, context)
```

泛型 `A` 表示经过 Zod 校验后的具体参数类型。例如，`web-fetch` 的 `A` 可能是：

```ts
{ url: string }
```

`AgentTool` 不关心参数具体有哪些字段，只要求 Schema 与 `run()` 的参数类型一致。

### 4.4 为什么工具类别只有 `read` 和 `proposal`

MindTree 的安全边界是：模型输出始终只是候选，不能绕过用户确认直接改写导图。

因此第一版只允许：

```text
read      读取信息，可以自动执行
proposal  生成候选，可以执行，但结果不能直接写入
```

这里故意不定义：

```text
write
delete
execute
```

这不是因为未来永远不能写入，而是写入不属于模型工具权限。正确链路是：

```text
branch-propose
  → 生成候选
  → UI 展示预览
  → 用户确认
  → domain/commands 执行写入
```

这样权限约束不是只写在 Prompt 中，而是进入 TypeScript 类型系统和架构边界。

### 4.5 工具为什么需要 `ToolContext`

网页请求、文件读取可能耗时。如果用户点击取消，Loop 不应只停止下一轮，还要尽量通知当前工具终止。

所以工具执行时接收：

```ts
interface ToolContext {
  signal?: AbortSignal
}
```

以后还可以向 Context 增加经过审查的运行信息，例如 Trace ID，但不应该把整个 React Store 或数据库实例随意塞进去。

### 4.6 Tool Call 和 Tool Execution 不是一回事

`AgentToolCall` 是模型的请求：

```text
“请调用 web-fetch，参数是……”
```

`ToolExecution` 是宿主程序实际处理后的结果：

```text
“这次调用成功、被拒绝或失败，返回内容和耗时是……”
```

工具执行状态先定义为：

```text
ok       成功执行
denied   工具不存在或权限不允许
error    参数或运行过程出错
```

无论成功还是失败，都产生 `output`。这个文本会作为观察回填给模型，让模型自己决定下一步，例如修正参数、改用其他工具或向用户解释失败。

### 4.7 Loop 需要向外报告过程事件

材料整理可能经过多轮：

```text
第 1 步：模型决定读取网页
第 1 步：web-fetch 返回正文
第 2 步：模型决定生成候选
第 2 步：branch-propose 返回候选
第 3 步：模型给出最终说明
```

UI、日志和测试都需要知道这些动作，但不应该直接读取 Loop 的局部变量。因此定义 `AgentEvent`：

```text
step-start
tool-call
tool-result
final
budget-exceeded
```

Loop 只负责发出结构化事件：

```ts
onEvent?.(event)
```

`trace.ts` 再负责把事件转换成中文摘要。这样 Loop 与展示逻辑解耦。

这里记录的是可观察的动作和结果，不记录模型隐藏思维链。

### 4.8 业务层需要知道 Agent 为什么结束

Agent 不一定总是正常完成，它可能：

- 正常得到最终回答。
- 达到最大步骤数。
- 被用户取消。
- 模型请求失败。

因此定义：

```ts
type AgentRunStatus =
  | 'completed'
  | 'budget-exceeded'
  | 'aborted'
  | 'failed'
```

最终的 `AgentRunResult` 不只返回一段文本，还返回：

- 结束状态。
- 最终内容或错误信息。
- 实际步骤数。
- 完整消息记录。

业务层可以据此决定展示结果、提示重试，还是显示用户已取消。

### 4.9 为什么还需要 `ModelResponse` 和 `ModelClient`

不同模型供应商的响应字段可能不同，但 Loop 真正关心的只有：

```text
模型生成的文本
模型请求的工具调用
```

所以定义统一的 `ModelResponse`：

```ts
interface ModelResponse {
  content: string
  toolCalls: AgentToolCall[]
}
```

再把模型能力压缩成最小接口：

```ts
interface ModelClient {
  chat(messages, tools, signal): Promise<ModelResponse>
}
```

这样生产环境可以实现 `OpenAiModelClient`，测试环境可以实现 `ScriptedModelClient`。Loop 不需要知道自己面对的是真模型还是测试假模型。

这也是后面能够做确定性单元测试的关键。

## 5. 最终类型关系

```text
ModelClient
  ├── 输入 AgentMessage[]
  ├── 输入 AgentTool[]
  └── 返回 ModelResponse
               ├── content
               └── AgentToolCall[]
                         │
                         ▼
                  ToolRegistry 执行
                         │
                         ▼
                   ToolExecution
                         │
                         ▼
                  Tool Message 回填

Loop 执行全过程
  ├── 发出 AgentEvent
  └── 返回 AgentRunResult
```

## 6. 你实际手写时的顺序

不要直接从参考源码第一行抄到最后一行。建议按下面顺序在空文件中逐段写：

1. 导入 `ZodType` 类型。
2. 写 `AgentRole`。
3. 写 `AgentToolCall`。
4. 写 `AgentMessage`。
5. 写 `ToolCategory`。
6. 写 `ToolContext`。
7. 写泛型 `AgentTool<A>`。
8. 写 `ToolExecutionStatus` 和 `ToolExecution`。
9. 写联合类型 `AgentEvent`。
10. 写 `AgentRunStatus` 和 `AgentRunResult`。
11. 写 `ModelResponse` 和 `ModelClient`。
12. 回头检查每个字段由谁产生、由谁消费。

手写过程中，每增加一个类型，都先用一句话回答：

> 如果没有这个类型，后面的哪个模块会无法清晰表达自己的输入或输出？

如果答不出来，说明这个类型可能暂时不需要。

## 7. 需要你重点理解的设计选择

### 选择一：内部协议与供应商协议分离

`types.ts` 不引用 OpenAI SDK。供应商适配只发生在 `model-client.ts`。

收益：

- 更换模型不影响 Loop。
- 测试假模型容易实现。
- 核心逻辑不会到处出现 `choices[0].message` 等字段。

### 选择二：工具参数延迟解析

`AgentToolCall.arguments` 保存原始字符串，统一在 Tool Registry 中解析和校验。

收益：

- 不可信边界清晰。
- 所有工具共享同一套错误语义。
- 非法 JSON 不会偷偷进入具体业务工具。

### 选择三：不向模型提供写工具

候选生成与最终写入分离。

收益：

- Prompt 注入不能直接获得导图写权限。
- 用户可以预览、修改和拒绝结果。
- 写入仍复用 MindTree 现有 Command、撤销和校验能力。

### 选择四：事件与结果分离

`AgentEvent` 表达运行中的过程；`AgentRunResult` 表达运行结束后的总结。

收益：

- UI 可以实时展示步骤。
- 测试可以断言事件顺序。
- 业务层只处理最终状态，不需要自己拼装过程数据。

## 8. 第一版暂时没有解决的问题

这份 `types.ts` 是 Harness MVP 协议，不代表最终形态。暂时没有加入：

- 精确 Token Usage。
- Trace ID、Span ID。
- 模型名称和 Prompt 版本。
- 单工具超时状态。
- 重试次数。
- 工具结果的结构化对象与显示摘要分离。
- 图片、音频等多模态消息内容。
- 流式文本 Delta 事件。
- 人工审批等待状态。

这些能力应该在真实需求出现时扩展，而不是第一天全部塞进类型系统。

## 9. 手写完成后的自检

- [ ] `types.ts` 只包含类型，没有运行逻辑。
- [ ] 没有引用 OpenAI、Anthropic 等供应商 SDK 类型。
- [ ] 工具参数在校验前仍是原始字符串。
- [ ] 每个工具都必须携带 Zod Schema。
- [ ] 工具类别中没有 `write` 或 `delete`。
- [ ] Tool Message 能通过 ID 关联 Tool Call。
- [ ] 工具失败有统一结果，而不是只能抛异常。
- [ ] Loop 能通过事件对外报告过程。
- [ ] 业务层能区分完成、预算耗尽、取消和失败。
- [ ] 测试假模型可以实现 `ModelClient`，不需要继承生产客户端。

## 10. 思考题

先不看参考源码，尝试回答：

1. 为什么 `AgentTool.run()` 返回 `Promise<unknown>`，而不是固定返回 `string`？
2. 为什么 `AgentMessage.toolCalls` 是数组，而不是单个 Tool Call？
3. `denied` 和 `error` 对模型来说有什么区别？
4. 为什么 `budget-exceeded` 既出现在事件中，也出现在最终状态中？
5. 如果以后需要人工审批，应该扩展 Tool Category、Agent Event，还是两者都需要？
6. 如果以后支持图片输入，最可能修改哪个类型？哪些运行模块不应该受影响？

## 11. 参考 TS 源码

下面是这一课的完整参考实现。建议先根据前文独立手写，再逐项对照字段、注释和类型关系。

```ts
import type { ZodType } from 'zod'

/**
 * Agent Harness 内部使用的消息角色。
 *
 * 这里不直接引用 OpenAI 等厂商 SDK 的 Role 类型，因为 Harness 应当保持模型无关：
 * - model-client 负责把内部消息转换成具体供应商协议；
 * - loop、tool-registry 等核心模块只理解这里定义的统一协议。
 */
export type AgentRole = 'system' | 'user' | 'assistant' | 'tool'

/** 模型要求宿主程序执行的一次工具调用。 */
export interface AgentToolCall {
  /** 一次调用的唯一标识，用来关联后续 Tool Message。 */
  id: string
  /** 被调用的工具名称，必须能在 ToolRegistry 中找到。 */
  name: string
  /**
   * 模型返回的原始 JSON 字符串。
   * 解析与 Schema 校验由 tool-registry 负责。
   */
  arguments: string
}

/** Agent Harness 内部统一的消息结构。 */
export interface AgentMessage {
  role: AgentRole
  /** 纯工具调用的 Assistant Message 可以使用空字符串。 */
  content: string
  /** Assistant Message 可以携带一个或多个工具调用。 */
  toolCalls?: AgentToolCall[]
  /** Tool Message 用它关联对应的 AgentToolCall.id。 */
  toolCallId?: string
}

/**
 * 工具类别同时表达权限边界：
 * - read：只读取材，可以自动执行；
 * - proposal：只产出候选，最终写入必须经过用户确认。
 */
export type ToolCategory = 'read' | 'proposal'

/** Harness 在执行工具时提供的运行环境。 */
export interface ToolContext {
  signal?: AbortSignal//可选的AbortSignal，用于终止工具执行
}

/** Agent 可以调用的统一工具接口。 */
export interface AgentTool<A = unknown> {
  readonly name: string
  readonly description: string
  readonly category: ToolCategory
  readonly schema: ZodType<A>
  run(args: A, context: ToolContext): Promise<unknown>
}

/** 一次工具执行的标准结果状态。 */
export type ToolExecutionStatus = 'ok' | 'denied' | 'error'

/** 工具注册表执行一次 Tool Call 后返回的统一结果。 */
export interface ToolExecution {
  call: AgentToolCall
  status: ToolExecutionStatus
  /** 回填给模型的观察文本；成功结果应已序列化并截断。 */
  output: string
  durationMs: number
}

/** Agent 运行过程中的结构化事件。 */
export type AgentEvent =
  | { type: 'step-start'; step: number }
  | { type: 'tool-call'; step: number; call: AgentToolCall }
  | { type: 'tool-result'; step: number; execution: ToolExecution }
  | { type: 'final'; step: number; content: string }
  | { type: 'budget-exceeded'; step: number }

/** 一次 Agent 运行的最终状态。 */
export type AgentRunStatus = 'completed' | 'budget-exceeded' | 'aborted' | 'failed'

/** Agent Loop 结束后返回给业务层的完整结果。 */
export interface AgentRunResult {
  status: AgentRunStatus
  /** completed 时是最终回答，failed 时是错误信息，其余状态为空字符串。 */
  finalContent: string
  steps: number
  messages: AgentMessage[]
}

/** 模型客户端归一化后的响应。 */
export interface ModelResponse {
  content: string
  toolCalls: AgentToolCall[]
}

/** Harness 依赖的最小模型接口。 */
export interface ModelClient {
  chat(messages: AgentMessage[], tools: AgentTool[], signal?: AbortSignal): Promise<ModelResponse>
}
```

完成手写后，先不要继续第二课。先逐项对照自检清单，并确保你能用自己的话解释每一个类型为什么存在。
