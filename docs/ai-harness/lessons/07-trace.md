# 第七课：用 `trace.ts` 记录可审计的 Agent 运行轨迹

## 1. 这一课要完成什么

这一课只设计和手写一个文件：

```text
src/agent/trace.ts
```

这个文件不会调用模型、执行工具，也不控制循环。它只负责接收第一课定义的 `AgentEvent`，将事件保存为结构化轨迹，并生成适合用户或开发者快速阅读的中文摘要。

第一版需要完成：

1. 定义一条 Trace Entry 的稳定结构。
2. 按事件到达顺序保存轨迹。
3. 为不同 Agent Event 生成中文摘要。
4. 记录每条轨迹进入 Tracer 的时间。
5. 保持 Trace 与 Loop 解耦。

完成后，你应该能够回答：

1. 为什么 Agent 比普通请求更需要步骤级可观测性？
2. `AgentEvent` 和 `TraceEntry` 有什么区别？
3. 为什么 Loop 只负责发事件，而不直接拼中文日志？
4. 为什么 Trace 应记录工具名称、结果状态和耗时？
5. 为什么不能把模型隐藏思维链当成 Trace？
6. 为什么最终回答要截成摘要，而工具结果不应完整复制到摘要？
7. 内存 Trace 能解决什么，不能解决什么？

## 2. 项目需求背景：Agent 出错时，“失败了”远远不够

普通 HTTP 请求通常是：

```text
用户请求
  → 服务处理
  → 返回结果
```

材料整理 Agent 则可能经过：

```text
用户要求整理网页
  → 第 1 步请求模型
  → 模型调用 web-fetch
  → web-fetch 返回正文
  → 第 2 步请求模型
  → 模型调用 map-read
  → map-read 返回当前导图
  → 第 3 步请求模型
  → 模型调用 branch-propose
  → 候选校验失败
  → 第 4 步模型修正参数
  → 候选生成成功
  → 模型返回最终说明
```

如果最终只显示：

```text
整理失败
```

用户和开发者都无法判断：

- 是模型请求失败了吗？
- 模型选错工具了吗？
- 网页读取超时了吗？
- 工具参数不符合 Schema 吗？
- 候选节点超过数量限制了吗？
- Agent 达到步数上限了吗？
- 用户取消了吗？
- 哪一步最耗时？

Agent 的路径是动态的。同样的用户输入，在不同模型或材料下可能选择不同工具和步骤。没有步骤级 Trace，就很难复现和改进。

因此 Harness 需要回答：

> 这次运行按什么顺序发生了哪些可观察动作，每一步结果如何？

## 3. 可观测性不等于打印一大段日志

最简单的做法是在 Loop 中写：

```ts
console.log('开始第 1 步')
console.log('调用 web-fetch')
console.log('结果是', result)
```

这会产生问题：

- 日志格式不稳定，难以测试和查询。
- Loop 混入中文展示逻辑。
- UI 不能方便地消费 Console Output。
- 工具结果可能包含大量正文或敏感信息。
- 无法区分事件种类，只能做字符串搜索。
- 后续要接数据库或 OTel 时需要重写 Loop。

正确方向是：

```text
Loop 发出结构化 AgentEvent
  → Tracer 保存结构化 TraceEntry
  → UI、日志、测试分别消费 TraceEntry
```

结构化数据是事实，中文摘要只是其中一种展示。

## 4. `trace.ts` 在 Harness 中的位置

```text
Agent Loop
   │
   │ onEvent(event)
   ▼
AgentTracer.handle
   │
   ├── 保留 step
   ├── 保留 event type
   ├── 生成 summary
   └── 记录 timestamp
   │
   ▼
TraceEntry[]
   ├── UI 展示执行过程
   ├── 测试断言事件顺序
   └── 后续持久化或导出
```

使用方式会是：

```ts
const tracer = new AgentTracer()

await runAgentLoop({
  // ...
  onEvent: tracer.handle,
})

console.log(tracer.entries)
```

为什么 `handle` 设计成可直接传递的函数？

这样 Loop 只依赖一个回调签名，不需要知道 Tracer 类的存在。

## 5. 先区分 `AgentEvent` 与 `TraceEntry`

### 5.1 `AgentEvent`：运行时事实

第一课定义的事件包括：

```text
step-start
tool-call
tool-result
final
budget-exceeded
```

事件携带运行现场的数据，例如：

- Tool Call。
- Tool Execution。
- 最终 Content。
- 当前 Step。

它由 Loop 产生，是模块之间的事件协议。

### 5.2 `TraceEntry`：面向记录和展示的投影

第一版 Trace Entry 只保留：

```text
step
kind
summary
at
```

其中：

- `step`：发生在第几步。
- `kind`：原事件种类。
- `summary`：用户可读的中文摘要。
- `at`：记录时间戳。

为什么不把完整 Event 原样复制进 Entry？

- Tool Args 和 Observation 可能很大。
- 可能包含材料正文或敏感信息。
- 第一版 UI 只需要步骤摘要。
- 完整 Event 可以由其他审计层另行保存。

这是一种投影：从丰富运行事件中提取当前展示真正需要的信息。

## 6. 推导 `TraceEntry`

### 6.1 `step`

材料整理 Agent 是多轮循环。没有 Step，用户只能看到事件顺序，无法知道哪些 Tool Calls 属于同一次模型决策。

例如一次模型响应可能同时请求多个工具：

```text
第 2 步：调用 fs-read(a.md)
第 2 步：调用 fs-read(b.md)
```

两条工具轨迹共享同一个 Step。

### 6.2 `kind`

类型直接复用：

```ts
AgentEvent['type']
```

这样 `AgentEvent` 新增类型时，Trace Entry 的 Kind 联合类型会自动同步，编译器也会提醒摘要函数处理新分支。

### 6.3 `summary`

摘要是给人看的短文本，例如：

```text
第 1 步：等待模型决策
调用工具 web-fetch
web-fetch 完成（352ms，4380 字）
branch-propose 出错：参数不符合要求
完成：已生成思维树候选
达到步数上限，停止循环
```

摘要不是完整日志，也不是模型上下文。

### 6.4 `at`

第一版使用 Unix 毫秒时间戳：

```text
Date.now()
```

它可以用于：

- UI 排序。
- 观察事件发生时间。
- 后续粗略计算事件间隔。

工具本身的精确耗时仍来自 `ToolExecution.durationMs`，不依赖两条 Entry 时间相减。

## 7. 为什么 `AgentTracer.entries` 是只读引用

可以定义：

```ts
readonly entries: TraceEntry[] = []
```

这里的 `readonly` 表示不能把整个属性重新赋值：

```ts
tracer.entries = [] // 不允许
```

但数组内部仍可以由 Tracer 执行：

```ts
this.entries.push(entry)
```

这能保持 Tracer 自己持续收集事件，同时避免调用方意外替换容器引用。

需要注意：调用方仍然可以对公开数组调用 `push()`。更严格的生产设计可以：

- 私有保存数组。
- 通过 Getter 返回 `readonly TraceEntry[]`。
- 返回数组副本。

第一版保持简单，方便测试读取。

## 8. 为什么 `handle` 使用箭头函数属性

如果写成普通方法：

```ts
handle(event: AgentEvent) {
  this.entries.push(...)
}
```

直接传递：

```ts
onEvent: tracer.handle
```

在某些调用方式中可能丢失 `this` 绑定。

定义成箭头函数属性：

```ts
readonly handle = (event: AgentEvent) => {
  this.entries.push(...)
}
```

箭头函数捕获实例 `this`，可以安全作为回调传递。

这是一个小但重要的工程细节。

## 9. 为每种事件设计摘要

需要一个内部函数：

```text
AgentEvent → string
```

建议不导出，因为当前只供 Tracer 使用。测试通过 `entries.summary` 验证即可。

### 9.1 `step-start`

事件表示 Loop 即将请求模型：

```text
第 N 步：等待模型决策
```

这里没有宣称模型正在“思考什么”，只描述可观察事实：即将进行一次模型决策。

### 9.2 `tool-call`

摘要：

```text
调用工具 {toolName}
```

为什么不默认展示完整 Arguments？

- 参数可能包含 URL、文件路径或材料内容。
- 参数可能很长。
- 参数可能包含敏感数据。
- 第一版用户只需知道调用了什么能力。

开发模式需要参数时，应做脱敏、截断并单独展示。

### 9.3 成功的 `tool-result`

摘要：

```text
{toolName} 完成（{durationMs}ms，{outputLength} 字）
```

为什么记录 Output 长度而不是完整 Output？

- 可以判断工具是否返回了异常大内容。
- 不复制网页或文件正文。
- Trace 保持简短。

为什么记录耗时？

- 找出慢工具。
- 区分模型延迟和工具延迟。
- 为后续超时和性能优化提供依据。

### 9.4 被拒绝的 `tool-result`

摘要：

```text
{toolName} 被拒绝：{reason}
```

这能明确区分权限边界与运行错误。

例如：

```text
delete-document 被拒绝：模型请求了未注册的工具
```

### 9.5 失败的 `tool-result`

摘要：

```text
{toolName} 出错：{errorObservation}
```

这类错误可能是参数非法、文件不存在或请求超时。

第一版直接使用 Tool Execution Output。后续应增加统一截断和脱敏，避免下游错误消息过长。

### 9.6 `final`

最终回答可能很长，Trace 只展示前 80 个字符：

```text
长度 <= 80 → 完成：完整内容
长度 > 80  → 完成：前 80 字…
```

完整最终内容已经存在 `AgentRunResult.finalContent`，Trace 不需要重复保存一份。

### 9.7 `budget-exceeded`

摘要：

```text
达到步数上限，停止循环
```

它不是普通 Tool Error，而是 Harness 的终止策略生效。

## 10. 为什么使用 `switch` 处理联合类型

`AgentEvent` 是可辨识联合类型：

```ts
event.type
```

使用 Switch 后，TypeScript 能在每个分支自动收窄：

```text
tool-call   分支知道 event.call 存在
tool-result 分支知道 event.execution 存在
final       分支知道 event.content 存在
```

这比大量可选字段和空值判断更安全。

当以后向 `AgentEvent` 增加：

```text
aborted
model-error
tool-timeout
```

摘要函数也应同步增加分支。

更严格的写法可以添加 `assertNever()` 做穷尽检查；第一版 Switch 已能保持清晰。

## 11. 为什么不能记录模型隐藏思维链

Agent Trace 应记录：

- 输入了哪个任务。
- 请求了哪个模型。
- 选择了哪个工具。
- 参数是否合法。
- 工具执行是否成功。
- 返回了多少内容。
- 运行何时终止。

不应该要求或保存模型完整隐藏推理过程。

原因包括：

- 隐藏思维链不是稳定、可靠的事实记录。
- 可能暴露敏感上下文或内部策略。
- 大量自然语言推理难以结构化查询。
- 用户真正需要的是可审计动作与依据。
- 模型供应商未必提供隐藏推理内容。

如果产品需要解释，可以记录简短、可验证的决策摘要，例如：

```text
因为输入是网页 URL，所以选择 web-fetch
```

但应把它设计成显式结构化字段，而不是抓取隐藏思维链。

## 12. Trace 与日志、指标、事件的区别

### Event

模块间实时通知：

```text
刚刚发生了什么？
```

### Trace

单次 Agent Run 的步骤链：

```text
这次运行按什么顺序走过哪些步骤？
```

### Log

系统运行记录，通常跨请求聚合：

```text
某个时间发生了什么系统事件？
```

### Metric

可聚合数字：

```text
成功率、P95 延迟、平均工具调用数、预算耗尽率
```

第一版 `AgentTracer` 只是单次运行的内存 Trace，不等于完整可观测平台。

## 13. 为什么 Trace 不应影响 Agent 结果

理想情况下，Trace 失败不应改变 Agent 业务行为。

例如 UI 摘要格式错误，不应该阻止工具执行。

第一版的 `onEvent` 是同步回调。如果回调抛异常，可能传播到 Loop。后续生产设计可以：

- Loop 在调用观察回调时捕获异常。
- 使用多个独立 Subscriber。
- 异步批量写入日志系统。
- 对 Trace 失败单独告警。

当前课程先实现简单 Tracer，理解这一边界即可。

## 14. 为什么第一版只存内存

内存 Trace 足以完成：

- UI 实时显示当前运行步骤。
- 单元测试断言事件顺序。
- 当前会话内调试。
- 验证 Harness 事件协议。

但页面刷新或应用退出后会丢失，无法支持：

- 线上事故复盘。
- 跨会话历史查询。
- Bad Case 数据集回流。
- 多用户审计。
- 成本和性能趋势分析。

后续可以将相同 `AgentEvent` 投影到：

- IndexedDB。
- 服务端数据库。
- JSONL 日志。
- OpenTelemetry Span。
- Langfuse 等系统。

先稳定 Event Protocol，再选择存储系统，比一开始绑定某个观测平台更合理。

## 15. 一次完整轨迹示例

假设模型先调用 Echo，再返回最终文本：

```text
Event 1
{ type: 'step-start', step: 1 }

Trace
第 1 步：等待模型决策

Event 2
{ type: 'tool-call', step: 1, call: { name: 'echo', ... } }

Trace
调用工具 echo

Event 3
{ type: 'tool-result', step: 1, execution: { status: 'ok', ... } }

Trace
echo 完成（1ms，15 字）

Event 4
{ type: 'step-start', step: 2 }

Trace
第 2 步：等待模型决策

Event 5
{ type: 'final', step: 2, content: '整理完成' }

Trace
完成：整理完成
```

事件和 Trace Entry 保持一对一顺序，测试就能检查 Harness 是否按预期运行。

## 16. 你实际手写时的顺序

### 第一步：导入 `AgentEvent`

只作为类型使用，因此采用类型导入。

### 第二步：定义 `TraceEntry`

依次写：

1. `step`
2. `kind`
3. `summary`
4. `at`

其中 Kind 复用 `AgentEvent['type']`。

### 第三步：定义 `AgentTracer`

先添加：

```text
readonly entries
```

再添加箭头函数形式的：

```text
readonly handle
```

### 第四步：在 `handle` 中构造 Entry

每收到一个 Event：

```text
复制 step
复制 type 为 kind
调用 summarizeEvent
记录 Date.now()
push 到 entries
```

### 第五步：实现摘要函数

按联合类型顺序处理：

1. `step-start`
2. `tool-call`
3. `tool-result`
4. `final`
5. `budget-exceeded`

`tool-result` 内再区分：

```text
ok
denied
error
```

### 第六步：运行测试

Trace 当前在 Loop 测试中验收：

```bash
npm test -- --run src/tests/agent/loop.test.ts
```

由于 Loop 是第八课，如果尚未实现，可以先执行 TypeScript 单文件检查，或者手动构造事件验证 Tracer。最终以第八课测试为准。

## 17. 测试需要验证什么

第八课的测试会模拟：

```text
步骤开始
  → Echo Tool Call
  → Echo Tool Result
  → 下一步开始
  → 最终回答
```

然后断言摘要包含：

- 第一条提到“第 1 步”。
- Tool Call 提到 `echo`。
- Tool Result 提到 `echo 完成`。
- 最后一条提到最终回答。

测试不应严格绑定每个空格或全部标点，否则文案调整会导致不必要的失败。

## 18. 常见错误

### 错误一：在 Loop 中直接拼中文日志

会让运行逻辑、UI 文案和日志格式耦合。

### 错误二：把完整 Tool Output 放进 Summary

网页正文可能数千字，还可能包含敏感信息。

### 错误三：把完整 Tool Args 放进用户 Trace

文件路径、查询和 Token 等信息需要脱敏策略。

### 错误四：将 Error 与 Denied 混为一类

用户无法区分权限拒绝和工具运行失败。

### 错误五：普通方法直接作为回调导致 `this` 丢失

使用箭头函数属性能保持实例绑定。

### 错误六：把完整最终回答重复保存进摘要

会造成内存和持久化重复；Trace 只需简要预览。

### 错误七：记录模型隐藏思维链

Trace 应记录可验证动作，不应依赖不可控的内部推理文本。

### 错误八：认为内存 Trace 等于生产可观测性

它无法跨刷新、聚合指标或支持长期审计。

### 错误九：Trace 回调异常导致 Agent 失败

当前简单实现存在这个边界，生产 Loop 应隔离观察者异常。

## 19. 第一版的已知边界

当前 Trace 还没有：

- Run ID、Trace ID 和 Span ID。
- Parent Span 关系。
- 模型名称和版本。
- Prompt 版本。
- 请求和响应 Token Usage。
- 模型调用耗时。
- 工具参数脱敏摘要。
- Observation 安全摘要。
- 用户、租户和会话 ID。
- 异步持久化。
- Trace 查询和导出。
- Error Code。
- 重试次数和降级记录。
- `aborted`、`failed` 等显式事件。
- 多 Subscriber。
- Clock 注入和确定性时间测试。

这些都是后续从“可看见”走向“可运营”的演进方向。

## 20. 手写完成后的自检

- [ ] `trace.ts` 只依赖 `AgentEvent` 类型。
- [ ] `TraceEntry.kind` 复用 `AgentEvent['type']`。
- [ ] Tracer 按事件到达顺序追加 Entry。
- [ ] `handle` 可以直接作为回调传递。
- [ ] 每条 Entry 包含 Step、Kind、Summary 和时间。
- [ ] Tool Call 摘要不暴露完整参数。
- [ ] 成功结果显示工具名、耗时和输出长度。
- [ ] Denied 与 Error 使用不同文案。
- [ ] 最终回答过长时只保留摘要。
- [ ] Budget Exceeded 有明确终止文案。
- [ ] 没有记录模型隐藏思维链。
- [ ] 没有执行工具或修改 Loop 状态。
- [ ] 能说明 Event、Trace、Log、Metric 的区别。
- [ ] 第八课完成后，Tracer 相关 Loop 测试通过。

## 21. 思考题

1. 为什么 Agent Event 是事实协议，而 Trace Summary 只是展示投影？
2. 如果 Trace 保存完整网页正文，会带来哪些成本和安全问题？
3. 为什么 Tool Execution 自带 Duration，比用两条 Entry 时间戳相减更可靠？
4. 如果一次模型响应并行调用三个工具，它们的 Step 应该相同还是不同？
5. 如果以后接 OpenTelemetry，哪些 Event 可以映射成 Span？
6. 为什么模型隐藏思维链不适合作为生产审计日志？
7. Trace 持久化失败时，Agent 主任务应该怎样处理？
8. 为了建立离线评测集，Trace 还应该增加哪些结构化字段？

## 22. 参考 TS 源码

建议先根据前文独立手写，再对照下面的参考实现。

```ts
import type { AgentEvent } from './types'

export interface TraceEntry {
  step: number
  kind: AgentEvent['type']
  /** 给用户看的一行中文摘要，例如“调用工具 web-fetch”。 */
  summary: string
  at: number
}

/**
 * 收集 Agent 运行轨迹：把 tracer.handle 传给 Loop 的 onEvent，
 * 循环结束后 entries 即为当前运行的步骤摘要。
 */
export class AgentTracer {
  readonly entries: TraceEntry[] = []

  readonly handle = (event: AgentEvent) => {
    this.entries.push({
      step: event.step,
      kind: event.type,
      summary: summarizeEvent(event),
      at: Date.now(),
    })
  }
}

function summarizeEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'step-start':
      return `第 ${event.step} 步：等待模型决策`

    case 'tool-call':
      return `调用工具 ${event.call.name}`

    case 'tool-result': {
      const { execution } = event

      if (execution.status === 'ok') {
        return `${execution.call.name} 完成（${execution.durationMs}ms，${execution.output.length} 字）`
      }

      if (execution.status === 'denied') {
        return `${execution.call.name} 被拒绝：${execution.output}`
      }

      return `${execution.call.name} 出错：${execution.output}`
    }

    case 'final':
      return event.content.length > 80
        ? `完成：${event.content.slice(0, 80)}…`
        : `完成：${event.content}`

    case 'budget-exceeded':
      return '达到步数上限，停止循环'
  }
}
```

完成后，如果 `loop.ts` 尚未实现，可以暂时只做 TypeScript 检查。第八课完成后统一运行：

```bash
npm test -- --run src/tests/agent/loop.test.ts
```

进入第八课前，先确认你能用自己的话说明：Trace 记录的是“Agent 做了什么”，而不是“模型秘密想了什么”。
