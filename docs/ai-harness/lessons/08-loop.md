# 第八课：用 `loop.ts` 完成 Agent Harness 核心循环

## 1. 这一课要完成什么

这一课只设计和手写一个文件：

```text
src/agent/loop.ts
```

它是前七课的总装配层，也是 Agent Harness 最核心的运行逻辑。

前七课已经分别准备了：

```text
types.ts          内部消息、工具、事件和运行结果协议
tools/echo.ts     最小确定性工具
context.ts        Observation 截断与上下文预算函数
permissions.ts    工具权限判断
tool-registry.ts  工具注册、校验和单次执行
model-client.ts   模型协议适配
trace.ts          运行事件的可读轨迹
```

`loop.ts` 要把它们连接成闭环：

```text
请求模型
  → 模型返回最终文本：结束
  → 模型返回 Tool Call：执行工具
  → 把 Tool Result 作为 Observation 回填模型
  → 模型根据 Observation 再次决策
  → 直到完成、取消、失败或预算耗尽
```

完成后，你应该能够回答：

1. 普通模型请求与 Agent Loop 的根本区别是什么？
2. 为什么消息数组就是第一版循环的显式状态？
3. 为什么 Assistant Tool Call 必须先写入历史，再追加 Tool Message？
4. 为什么工具执行失败后循环可以继续，而模型请求失败通常必须终止？
5. Step Budget 如何保证循环最终停止？
6. `aborted`、`failed`、`budget-exceeded` 有什么不同？
7. 为什么 Loop 只依赖 `ModelClient` 接口，而不直接实例化生产客户端？
8. 为什么 Loop 发 Event，却不直接依赖 `AgentTracer`？

## 2. 项目需求背景：材料整理不是一次问答

如果 MindTree 只需要普通问答，流程可能是：

```text
用户输入
  → 调用模型一次
  → 显示回答
```

但是资料整理 Agent 不可能预先把所有外部内容都塞进 Prompt。它需要根据当前信息自主决定下一步：

```text
用户：整理这个网页，并结合当前项目导图生成候选

第 1 步
模型：我需要先读取网页
Tool Call：web-fetch
Observation：网页正文

第 2 步
模型：我还需要查看当前导图，避免重复内容
Tool Call：map-read
Observation：当前导图结构

第 3 步
模型：我已经有足够信息，可以生成候选
Tool Call：branch-propose
Observation：候选已通过 Schema 校验

第 4 步
模型：整理完成，等待用户确认候选
Final Answer
```

模型第一次并不知道网页正文，也不知道工具执行是否成功。只有把每次结果重新放回消息历史，模型才能基于新观察继续决策。

所以 Agent 的关键不是“模型调用了一次工具”，而是形成：

```text
决策 → 行动 → 观察 → 再决策
```

`loop.ts` 就是这个循环的显式宿主。

## 3. Agent Loop 与固定 Workflow 的区别

固定 Workflow 会由程序提前规定每一步：

```text
一定先 web-fetch
  → 一定再 map-read
  → 一定再 branch-propose
```

Agent Loop 则只规定运行规则：

```text
每一步由模型选择是否调用工具、调用哪个工具
```

Harness 仍然控制：

- 模型能看到哪些工具。
- 工具参数如何校验。
- 哪些能力允许执行。
- 最多运行多少步。
- 用户何时可以取消。
- 每一步如何记录。
- 候选能否真正写入。

因此“模型自主决策”不代表“模型拥有无限权限”。

可以理解为：

```text
模型负责策略选择
Harness 负责执行边界和生命周期
```

## 4. `loop.ts` 在整体架构中的位置

```text
src/ai/ingest/ingest-service.ts       未来业务层
           │
           │ 组装 Task、Prompt、Model、Tools
           ▼
       runAgentLoop
           │
           ├──── ModelClient.chat
           │          │
           │          └── ModelResponse
           │
           ├──── ToolRegistry.list
           │
           ├──── executeToolCall
           │          │
           │          └── ToolExecution
           │
           └──── onEvent(AgentEvent)
                      │
                      └── AgentTracer / UI / Test
```

Loop 不应该知道：

- 用户输入的是网页还是文件夹。
- MindTree 节点 Schema 的具体字段。
- 使用的是 DeepSeek 还是 OpenAI。
- Trace 最终保存在内存还是数据库。
- 候选 UI 如何展示。

它只理解第一课定义的通用协议。

## 5. 先推导 Loop 的输入配置

需要一个：

```text
AgentLoopOptions
```

将本次运行需要的依赖和策略显式传入。

### 5.1 `model`

类型：

```text
ModelClient
```

Loop 只调用：

```text
model.chat(messages, tools, signal)
```

生产环境可以传 `OpenAiModelClient`，测试可以传 `ScriptedModelClient`。

### 5.2 `registry`

类型：

```text
ToolRegistry
```

它代表本次任务允许模型使用的最小工具集合。

不同任务可以传不同 Registry，Loop 不需要知道具体工具。

### 5.3 `messages`

类型：

```text
AgentMessage[]
```

通常初始消息包含：

```text
System Message：Agent 规则和输出协议
User Message：用户任务
```

Loop 会在其基础上追加 Assistant 和 Tool Messages。

### 5.4 `maxSteps`

一次模型决策计为一步。

第一版默认：

```text
8 步
```

为什么必须有硬上限？

- 模型可能持续调用同一个工具。
- 工具错误可能让模型反复修正。
- Prompt 或兼容端点可能陷入异常循环。
- 每一步都会增加延迟和成本。

硬上限是 Agent 最基本的终止护栏。

### 5.5 `maxObservationChars`

允许本次运行覆盖第三课的默认工具输出长度上限。

Loop 不自己截断，而是把该配置传给 Tool Registry 的统一执行入口。

### 5.6 `signal`

用户取消任务时使用的 `AbortSignal`。

它会传递给：

- Model Client 的网络请求。
- Tool Context 中的工具执行。

### 5.7 `onEvent`

可选事件回调：

```text
(event: AgentEvent) => void
```

可以连接：

- `AgentTracer.handle`。
- UI 实时状态更新。
- 测试事件数组。
- 后续结构化日志 Subscriber。

## 6. 为什么依赖都通过 Options 传入

不要在 `loop.ts` 内部：

```ts
const model = new OpenAiModelClient(...)
const registry = createGlobalRegistry()
```

否则 Loop 会依赖：

- 用户模型配置。
- API Key。
- 全局工具集合。
- 具体业务环境。

通过依赖注入，Loop 变成通用运行器：

```text
业务层决定用什么
Loop 只决定怎么运行
```

这也是确定性测试能够成立的基础。

## 7. 为什么消息历史是第一版 Agent State

第一版没有单独定义复杂状态机对象。循环状态主要存在于：

```text
messages
```

它记录：

- 用户最初提出了什么任务。
- 模型请求了哪些工具。
- 每个工具返回了什么观察。
- 模型如何继续推进。

例如：

```text
User
  请整理材料

Assistant
  Tool Call: echo(call-1)

Tool
  toolCallId: call-1
  {"echo":"材料"}

Assistant
  整理完成
```

每次调用 `model.chat()` 都把当前消息历史发给模型，模型因此能够看到之前的行动和观察。

后续材料整理业务还可能拥有独立结构化状态，例如候选、来源和进度，但通用 Loop 不应提前内置这些业务字段。

## 8. 为什么先复制初始消息数组

不要直接使用：

```ts
const messages = options.messages
```

因为后面会不断 `push()`。这会修改调用方传入的原数组，导致：

- 业务层保存的初始消息被污染。
- 同一输入重复运行时包含上次历史。
- 测试之间发生难以发现的状态共享。

第一版使用浅复制：

```ts
const messages = [...options.messages]
```

这样新增或删除数组元素不会影响调用方。

已知边界：消息对象本身仍共享引用。Loop 当前只追加新对象，不修改已有消息对象，因此浅复制足够。若以后需要修改旧消息，应考虑深复制或不可变结构。

## 9. 为什么运行开始前先获取工具列表

Registry 的工具列表在本次运行中通常保持不变：

```ts
const tools = registry.list()
```

每次请求模型都使用同一组工具声明。

如果运行中动态增加或删除工具，模型不同步骤看到的能力会变化，Trace 和复现会更复杂。第一版将工具集视为一次 Run 的固定配置。

后续需要动态工具路由时，可以在更高层按任务选出工具集合，再启动 Loop。

## 10. 为什么封装一个 `emit()`

Options 中的 `onEvent` 是可选的。可以定义：

```ts
const emit = (event: AgentEvent) => options.onEvent?.(event)
```

收益：

- 后续事件发射更简洁。
- Loop 不需要每次判断回调是否存在。
- 将来可以在一个位置隔离 Observer 异常。

第一版 `emit()` 没有捕获回调异常，这是已知边界。生产版本应避免 Trace/UI 回调抛错破坏 Agent 主任务。

## 11. 一步到底代表什么

在当前设计中：

```text
一次 model.chat() = 一个 Step
```

如果模型一次返回三个 Tool Calls：

- 它们都属于同一个 Step。
- 工具执行本身不会增加 Step。
- 执行完所有工具后，下一次模型请求才进入下一步。

这能清楚表达：

```text
Step 是模型决策轮次
Tool Call 是一次决策内的行动
```

## 12. 循环开始时为什么先检查取消信号

每一步开始前：

```text
signal.aborted?
  → 是：立即返回 aborted
  → 否：继续请求模型
```

如果用户在任务开始前已经取消，就不应浪费一次模型调用。

返回：

```text
status: aborted
finalContent: ''
steps: 已完成的步骤数
messages: 当前历史
```

为什么 Step 使用 `step - 1`？

因为本轮模型决策还没有开始，实际完成的决策轮数是前一轮。

## 13. `step-start` 事件应该在什么时候发出

取消检查通过后、请求模型之前发出：

```text
{ type: 'step-start', step }
```

它表达：

```text
Harness 即将开始第 N 次模型决策
```

不是表达模型已经成功返回。

UI 可以据此显示“等待模型决策”。

## 14. 模型调用为什么需要单独 Try/Catch

模型请求可能因为以下原因抛错：

- 网络失败。
- Endpoint 配置错误。
- 401 或余额不足。
- 429 限流。
- 响应缺少 Message。
- 用户取消导致 Fetch 抛 AbortError。

第一版捕获后返回：

```text
status: failed
finalContent: 错误文本
steps: 当前 Step
messages: 当前历史
```

为什么模型失败不能作为 Tool Observation 继续？

因为没有成功获得模型响应，也就没有同一个模型可以立即读取这个 Observation 并继续决策。

模型重试、备用模型和熔断应该由更高层模型路由策略处理，而不是伪装成 Tool Message。

## 15. 第一处分支：模型没有请求工具

归一化后的响应：

```ts
{
  content: '整理完成',
  toolCalls: [],
}
```

这表示模型给出了最终回复。

处理顺序：

```text
1. 追加 Assistant Message
2. 发出 final Event
3. 返回 completed AgentRunResult
```

为什么要先写入消息历史？

最终 `AgentRunResult.messages` 应包含模型最终回答，便于：

- UI 展示。
- 调试。
- 后续持久化。
- 测试断言。

## 16. 第二处分支：模型请求一个或多个工具

归一化响应可能是：

```ts
{
  content: '',
  toolCalls: [
    { id: 'call-1', name: 'web-fetch', arguments: '{...}' },
  ],
}
```

### 16.1 先追加 Assistant Tool Call Message

必须先保存：

```ts
{
  role: 'assistant',
  content: response.content,
  toolCalls: response.toolCalls,
}
```

然后才执行工具。

为什么？

下一轮发给模型的协议必须是：

```text
Assistant：我请求了 call-1
Tool：这是 call-1 的结果
```

如果只追加 Tool Message，模型会看到孤立 Observation。

### 16.2 遍历 Tool Calls

对于每一个调用：

```text
发出 tool-call Event
  → executeToolCall
  → 发出 tool-result Event
  → 追加 Tool Message
```

### 16.3 Tool Message 必须携带调用 ID

追加：

```ts
{
  role: 'tool',
  toolCallId: call.id,
  content: execution.output,
}
```

模型下一轮就能把每个 Observation 与原调用关联。

### 16.4 为什么失败结果也要追加

`executeToolCall()` 无论成功、拒绝还是出错，都会返回 `ToolExecution.output`。

因此都可以成为 Observation：

```text
成功：返回网页正文
拒绝：工具未注册
错误：参数不符合 Schema
```

模型可以在下一轮：

- 修正参数。
- 换工具。
- 停止危险操作。
- 向用户解释失败。

工具失败不等于 Loop 失败。

## 17. 多 Tool Calls 为什么第一版串行执行

一次模型响应可能包含多个 Tool Calls。

第一版使用：

```text
for...of + await
```

即串行执行。

优点：

- 事件顺序确定。
- 测试容易。
- 避免工具之间共享资源的并发问题。
- 更容易遵守权限和取消逻辑。

缺点：

- 多个独立读取工具总耗时更长。

后续只有确认工具：

- 都是只读。
- 没有依赖关系。
- 没有共享副作用。

才考虑 `Promise.all()` 并行。Proposal 或写入相关能力不应随意并行。

## 18. 为什么执行完工具后自然进入下一轮

处理完所有 Tool Calls 后，不需要显式写 `continue`。当前循环体走到末尾，`for` 自动进入下一 Step。

下一次 `model.chat()` 收到的消息历史已经多了：

```text
Assistant Tool Call
Tool Result
```

这就是 Observation 回填后的再决策。

## 19. Step Budget 如何终止无限循环

使用有界循环：

```text
for step = 1 ... maxSteps
```

如果每一步模型都继续请求工具，循环最终离开 For。

然后：

```text
发出 budget-exceeded Event
返回 budget-exceeded Result
```

为什么 `finalContent` 为空？

因为模型没有给出最终回答。不能把最后一次 Tool Observation 冒充最终结果。

业务层可以提示：

```text
任务达到步骤上限，请缩小范围或重试
```

## 20. 四种运行状态如何区分

### `completed`

模型返回没有 Tool Calls 的最终文本。

### `budget-exceeded`

模型一直没有收尾，Harness 的硬步骤上限生效。

### `aborted`

用户取消，并且 Loop 在步骤边界检查到了取消信号。

### `failed`

模型请求或响应处理抛出异常，无法继续进行下一次决策。

状态不能混用：

- Budget Exceeded 不是系统异常。
- Aborted 不是失败。
- Tool Error 不直接等于 Failed。

## 21. 事件顺序为什么是 Harness 行为合同

一次工具调用再完成的事件顺序应该是：

```text
step-start
tool-call
tool-result
step-start
final
```

它让：

- UI 能按顺序显示过程。
- Trace 能还原路径。
- 测试能验证循环语义。
- 后续观测系统能构建 Span。

不要在不同分支随意漏发或颠倒事件。

例如 Tool Result Event 应该在执行完成后、Tool Message 写回附近发出，以保证 Trace 与消息历史一致。

## 22. 用 Scripted Model 做确定性测试

真实模型输出不稳定，不能用来验证 Loop 的基本状态机。

`ScriptedModelClient` 可以预设：

```text
第 1 次 chat：返回 Echo Tool Call
第 2 次 chat：返回最终文本
```

测试随后检查：

- Loop 是否调用了两次模型。
- 第一次 Tool Result 是否进入消息历史。
- 第二次模型是否看到了 Tool Message。
- Tool Call ID 是否正确关联。
- Event 顺序是否正确。
- 最终状态是否为 Completed。

这把测试目标从“模型聪不聪明”变成“我们的 Harness 状态机是否正确”。

## 23. 测试场景逐个理解

### 23.1 模型直接回复

脚本第一轮就返回最终文本。

验证：

- 只运行一步。
- 状态 Completed。
- 最终 Assistant Message 被保存。

### 23.2 工具调用后继续

第一轮调用 Echo，第二轮返回最终文本。

验证：

- Observation 被回填。
- 第二次模型看到 Tool Message。
- Tool Call ID 保持一致。
- Event 顺序完整。

### 23.3 持续调用工具

模型每一步都请求 Echo。

验证：

- 达到 Max Steps 后停止。
- 不会无限运行。
- 状态是 Budget Exceeded。

### 23.4 开始前取消

Abort Controller 预先取消。

验证：

- 模型一次都没有被调用。
- 状态是 Aborted。

### 23.5 未注册工具

模型请求危险或不存在的工具。

验证：

- Registry 返回拒绝 Observation。
- Loop 没有崩溃。
- 模型下一轮能看到拒绝原因并收尾。

### 23.6 模型抛错

Model Client 抛出网络超时。

验证：

- Loop 不向调用方继续抛异常。
- 返回 Failed。
- Final Content 保存错误信息。

### 23.7 Trace 收集

把 `AgentTracer.handle` 传给 On Event。

验证：

- Tracer 收到完整事件。
- 中文摘要顺序正确。

## 24. 当前 Loop 与 `context.ts` 的关系

第三课实现了：

- `truncateObservation()`。
- `estimateTokens()`。
- `pruneMessages()`。

当前 Loop 通过 Tool Registry 间接使用 Observation 截断，但参考 MVP 尚未把：

```text
estimateTokens
pruneMessages
```

接入每轮模型请求。

这是需要明确承认的现状：

```text
已有上下文预算函数
但第一版 Loop 只落实了单次工具输出上限和 Step 上限
```

下一轮增强时可以在 `model.chat()` 前构造：

```text
modelMessages = pruneMessages(messages)
```

并根据 Token Budget 决定压缩或停止。

但要注意：

- `AgentRunResult.messages` 可以保留完整历史。
- 发给模型的 Messages 可以是裁剪投影。
- 不能直接覆盖完整 Trace 历史。

本课先按现有测试实现 MVP，不偷偷宣称 Token Budget 已完整接入。

## 25. 取消语义的已知边界

第一版在每一步开始前检查：

```text
signal.aborted
```

同时把 Signal 传给模型和工具。

但如果模型网络请求因取消抛出 `AbortError`，当前通用 Catch 会返回：

```text
failed
```

而不是：

```text
aborted
```

如果工具因取消报错，Registry 会把它转成 Error Observation；下一步开始时 Loop 才返回 Aborted。

更完整的实现应：

- Catch 后再次检查 `signal.aborted`。
- 或识别 Abort Error。
- 在模型调用后和每次工具调用后再次检查。
- 发出显式 Aborted Event。

本课参考源码保持与现有测试一致，同时把这个边界记录清楚。

## 26. 为什么模型错误文本放在 `finalContent`

当前 `AgentRunResult` 没有独立 `error` 字段，所以 `failed` 状态下使用：

```text
finalContent = 错误信息
```

优点：第一版接口简单。

缺点：字段语义混合了最终回答和错误文本。

后续更清晰的结果可以采用可辨识联合：

```text
completed → content
failed    → error
aborted   → reason
```

当前业务层必须先判断 Status，再解释 Final Content。

## 27. Loop 中哪些错误应该捕获

当前明确捕获：

```text
model.chat() 抛出的错误
```

Tool Error 已由 Registry 内部转换，不会正常抛出。

当前没有捕获：

- `onEvent` 回调抛错。
- Registry 本身的意外程序 Bug。
- 追加消息时的极端运行异常。

不应为了“永远不抛错”使用一个覆盖整个函数的大 Catch，把所有程序 Bug 都伪装成模型失败。错误边界需要有意义。

## 28. 为什么 Loop 不应该包含业务 Prompt

Loop 的职责是：

```text
运行协议
```

材料整理的职责是：

```text
任务语义
```

这些内容应该由未来的：

```text
src/ai/ingest/ingest-prompt.ts
src/ai/ingest/ingest-service.ts
```

组装成初始 Messages 后传入 Loop。

如果 Loop 写死“请整理成思维树”，它就无法复用于：

- 普通问答 Agent。
- 项目分析 Agent。
- 代码工具 Agent。
- 其他 MindTree AI 功能。

## 29. 你实际手写时的顺序

### 第一步：写依赖导入

需要：

- `executeToolCall`。
- `ToolRegistry`。
- `AgentEvent`、`AgentMessage`、`AgentRunResult`、`ModelClient` 类型。

区分运行时导入和类型导入。

### 第二步：定义默认 Step 上限

导出默认常量，方便测试和业务层复用。

### 第三步：定义 `AgentLoopOptions`

按顺序加入：

1. Model。
2. Registry。
3. Messages。
4. Max Steps。
5. Max Observation Chars。
6. Signal。
7. On Event。

### 第四步：搭建函数外壳

先完成：

- 解构 Model 和 Registry。
- 读取默认 Max Steps。
- 复制 Messages。
- 获取 Tools。
- 定义 Emit。

### 第五步：写有界 For Loop

从 Step 1 到 Max Steps。

先不要写模型和工具逻辑，只建立生命周期骨架。

### 第六步：加入取消检查和 Step Event

确保预先取消时不会请求模型。

### 第七步：加入 Model Call 和 Failed 分支

只围绕 `model.chat()` 写 Try/Catch。

### 第八步：加入 Final 分支

没有 Tool Calls 时：

- 追加 Assistant Message。
- 发 Final Event。
- 返回 Completed。

### 第九步：加入 Tool Call 分支

先追加 Assistant Tool Call Message，再遍历 Calls。

### 第十步：执行并回填每个工具

顺序不能乱：

```text
emit tool-call
execute
emit tool-result
push Tool Message
```

### 第十一步：加入预算耗尽返回

For Loop 外发事件并返回标准结果。

### 第十二步：运行测试

```bash
npm test -- --run src/tests/agent/loop.test.ts
```

然后运行全部 Harness 测试：

```bash
npm test -- --run src/tests/agent
```

## 30. 常见错误

### 错误一：只把 Tool Result 回填，不保存 Assistant Tool Call

会形成孤立 Tool Message，破坏协议关联。

### 错误二：执行工具前没有保存 Tool Call ID

下一轮模型无法知道结果属于哪次调用。

### 错误三：工具失败直接返回 Failed

会失去模型根据错误自我修正的能力。

### 错误四：模型错误被当作 Tool Observation

没有可用模型继续读取 Observation，本次运行无法推进。

### 错误五：没有 Step 上限

错误 Prompt 或模型可能造成无限工具循环和成本失控。

### 错误六：直接修改调用方 Messages 数组

会产生跨运行状态污染。

### 错误七：在 Loop 内创建生产 Model Client

导致配置耦合和测试困难。

### 错误八：Loop 直接依赖 AgentTracer

事件生产者会和某一种观察实现耦合。

### 错误九：一次 Tool Call 算一个 Step

会混淆模型决策轮次和工具行动次数。

### 错误十：Budget Exceeded 时伪造 Final Answer

工具结果不是模型最终结论。

### 错误十一：声称 Token Budget 已接入

当前 MVP 尚未在 Loop 中调用 `estimateTokens()` 和 `pruneMessages()`。

### 错误十二：并行执行所有工具

有副作用或依赖关系的工具可能产生竞态。

## 31. 第一版的已知边界

当前 Loop 还没有：

- 全局墙钟超时。
- 精确 Token Budget。
- 每轮消息裁剪接入。
- Tool Call 总数预算。
- 重复 Tool Call 检测。
- 无进展检测。
- 单工具超时。
- 工具重试策略。
- 模型重试、熔断和降级。
- Aborted 与 Failed 的完整异常区分。
- 显式 Run Started、Run Failed、Run Aborted Events。
- 模型调用耗时和 Token Usage Events。
- Observer 异常隔离。
- 并行只读工具调度。
- Human-in-the-Loop 暂停与恢复。
- Checkpoint 持久化和断点续跑。
- 动态工具路由。
- Final Answer 空文本校验。
- `maxSteps` 参数合法性校验。

这些正是完成材料整理 MVP 后可以继续训练的 Harness 工程能力。

## 32. 手写完成后的自检

- [ ] Loop 只依赖通用 Model Client、Tool Registry 和内部类型。
- [ ] 初始消息数组被复制，不直接 Push 到调用方数组。
- [ ] 本次 Run 的工具集合在开始时确定。
- [ ] 每次 Model Call 计为一个 Step。
- [ ] 每步开始前检查取消信号。
- [ ] 请求模型前发出 Step Start Event。
- [ ] 模型异常返回 Failed，不继续抛给业务层。
- [ ] 没有 Tool Calls 时保存最终 Assistant Message。
- [ ] Final Event 在 Completed 返回前发出。
- [ ] 有 Tool Calls 时先保存 Assistant Tool Call Message。
- [ ] 每个工具执行前发 Tool Call Event。
- [ ] 每个工具执行后发 Tool Result Event。
- [ ] Tool Message 使用正确的 Tool Call ID。
- [ ] 成功、拒绝和工具错误都会成为 Observation。
- [ ] 多 Tool Calls 第一版按顺序执行。
- [ ] 达到 Max Steps 后停止循环。
- [ ] Budget Exceeded 不伪造最终回答。
- [ ] Loop 中没有材料整理业务 Prompt。
- [ ] 能诚实说明 Token 裁剪尚未接入 Loop。
- [ ] Loop 单文件测试通过。
- [ ] Harness 全部测试通过。

## 33. 思考题

1. 为什么 Assistant Tool Call 和 Tool Message 必须同时存在于消息历史？
2. Tool Error 与 Model Error 为什么采用不同终止策略？
3. 如果一次模型响应有三个 Tool Calls，它们属于几个 Step？
4. 如果用户在模型请求途中取消，当前 MVP 可能返回什么状态？如何改进？
5. 完整消息历史和发给模型的裁剪消息为什么应该分开？
6. Step Budget、Tool Call Budget、Token Budget、Wall Clock Timeout 分别防止什么问题？
7. 如何检测模型连续三次调用同名同参工具而没有进展？
8. 如果加入 Human-in-the-Loop，Loop 需要增加什么状态和事件？
9. 为什么固定 Workflow 更容易预测，而 Agent Loop 更需要 Trace 和预算？
10. 材料整理 Agent 怎样判断“已有足够资料，可以停止调用工具”？这属于 Prompt、工具还是 Loop 的职责？

## 34. 参考 TS 源码

建议先根据前文独立手写，再对照下面的参考实现。

```ts
import { executeToolCall, ToolRegistry } from './tool-registry'
import type { AgentEvent, AgentMessage, AgentRunResult, ModelClient } from './types'

export const defaultMaxSteps = 8

export interface AgentLoopOptions {
  model: ModelClient
  registry: ToolRegistry
  /** 初始消息；循环内部追加新消息，不回写调用方数组。 */
  messages: AgentMessage[]
  maxSteps?: number
  maxObservationChars?: number
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
}

/**
 * Agent 核心循环：模型决策 → 工具执行 → Observation 回填 → 再决策，
 * 直到模型给出最终回复、达到步骤上限、被取消或模型请求失败。
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentRunResult> {
  const { model, registry } = options
  const maxSteps = options.maxSteps ?? defaultMaxSteps
  const messages: AgentMessage[] = [...options.messages]
  const tools = registry.list()
  const emit = (event: AgentEvent) => options.onEvent?.(event)

  for (let step = 1; step <= maxSteps; step += 1) {
    if (options.signal?.aborted) {
      return {
        status: 'aborted',
        finalContent: '',
        steps: step - 1,
        messages,
      }
    }

    emit({ type: 'step-start', step })

    let response
    try {
      response = await model.chat(messages, tools, options.signal)
    } catch (error) {
      return {
        status: 'failed',
        finalContent: error instanceof Error ? error.message : String(error),
        steps: step,
        messages,
      }
    }

    if (!response.toolCalls.length) {
      messages.push({
        role: 'assistant',
        content: response.content,
      })

      emit({
        type: 'final',
        step,
        content: response.content,
      })

      return {
        status: 'completed',
        finalContent: response.content,
        steps: step,
        messages,
      }
    }

    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    })

    for (const call of response.toolCalls) {
      emit({ type: 'tool-call', step, call })

      const execution = await executeToolCall(
        registry,
        call,
        { signal: options.signal },
        options.maxObservationChars,
      )

      emit({ type: 'tool-result', step, execution })

      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: execution.output,
      })
    }
  }

  emit({ type: 'budget-exceeded', step: maxSteps })

  return {
    status: 'budget-exceeded',
    finalContent: '',
    steps: maxSteps,
    messages,
  }
}
```

完成后先运行 Loop 测试：

```bash
npm test -- --run src/tests/agent/loop.test.ts
```

再运行整个 Harness 测试集：

```bash
npm test -- --run src/tests/agent
```

当前阶段目标是全部 Harness 测试通过。通过后不要立即堆叠 MCP、RAG 或多 Agent；下一阶段先用 `web-fetch` 和 `branch-propose` 打通一条真实的“材料读取 → 思维树候选 → 用户确认”纵向闭环。
