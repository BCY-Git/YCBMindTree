# 第三课：用 `context.ts` 控制 Agent 上下文预算

## 1. 这一课要完成什么

这一课只设计和手写一个文件：

```text
src/agent/context.ts
```

这个文件不调用模型、不执行工具，也不决定 Agent 下一步做什么。它只提供三个纯函数：

1. 截断单次工具观察结果。
2. 粗略估算消息占用的 Token。
3. 裁剪过长的消息历史，同时保持工具调用链完整。

完成后，你应该能够回答：

1. 为什么上下文管理属于 Harness，而不是 Prompt 的附属功能？
2. 为什么工具输出必须在回填模型前截断？
3. 字符数估算 Token 有什么价值，又有什么局限？
4. 为什么不能简单地对消息数组执行 `slice(-N)`？
5. Assistant Tool Call 和 Tool Message 为什么必须成组保留或成组丢弃？
6. 为什么 System Message 通常需要优先保留？
7. `context.ts` 为什么应该由纯函数组成？

## 2. 项目需求背景：材料可能远大于一次模型上下文

MindTree 的材料整理 Agent 将读取：

- 一篇网页文章。
- 一个 Markdown 文档。
- 一组本地文本文件。
- 当前思维导图结构。
- 工具执行失败信息。
- 多轮模型与工具交互历史。

这些内容会不断加入消息数组：

```text
System：整理规则
User：请整理这个网页
Assistant：调用 web-fetch
Tool：返回 20,000 字网页正文
Assistant：调用 map-read
Tool：返回当前导图结构
Assistant：继续分析并生成候选
```

如果不控制上下文，会出现四类问题。

### 问题一：超过模型上下文窗口

不同模型支持的上下文长度不同。一旦请求超过上限，模型端点可能直接返回错误。

### 问题二：成本和延迟持续上升

Agent 每进行一轮，通常会把已有消息重新发给模型。一个过长工具结果可能在后续每一轮重复计费和传输。

### 问题三：重要指令被材料淹没

即使模型能够接收全部内容，过多噪声也可能降低它对系统规则、用户目标和关键材料的关注。

### 问题四：错误裁剪破坏协议

如果只保留最后若干消息，可能出现：

```text
Tool：这是 call_123 的执行结果
```

但对应的 Assistant Tool Call 已经被删除。模型看到一个没有来源的 Tool Message，消息协议不再完整。

因此 Context Engineering 不只是“让 Prompt 短一点”，而是 Harness 的运行安全能力。

## 3. `context.ts` 在 Harness 中的位置

```text
工具执行结果
   │
   ▼
truncateObservation
   │
   ▼
Tool Message 加入历史
   │
   ▼
estimateTokens / pruneMessages
   │
   ▼
ModelClient 请求模型
```

当前课程只实现这些基础函数。后续 `tool-registry.ts` 会调用观察截断，`loop.ts` 或业务层会使用消息预算能力。

依赖方向应该是：

```text
context.ts
  → 只依赖 types.ts

tool-registry.ts
  → 依赖 context.ts

loop.ts
  → 可以依赖 context.ts
```

`context.ts` 不应依赖 Tool Registry、Model Client、React 或 MindTree Store。

## 4. 第一项能力：截断单次工具观察

### 4.1 什么是 Observation

在 ReAct 风格循环中，工具执行结果会作为观察回填给模型：

```text
Action：调用 web-fetch
Observation：网页正文……
```

在当前类型协议里，Observation 最终表现为 Tool Message 的 `content`。

### 4.2 为什么不能让工具无限返回

`web-fetch` 可能拿到：

- 50,000 字文章。
- 带大量导航和脚本的 HTML。
- 服务端异常页面。

`fs-read` 可能读到：

- 巨大日志。
- 错误选择的构建产物。
- 重复内容。

如果每个工具自己决定是否截断，会出现：

- 每个工具使用不同上限。
- 有的工具忘记截断。
- 截断标记格式不一致。
- 测试难以统一覆盖。

因此在 Harness 执行入口统一截断。

### 4.3 截断函数的输入与输出

需要一个纯函数：

```text
输入：文本 + 最大字符数
输出：原文本或截断后的文本
```

规则：

```text
长度 <= 上限
  → 原样返回

长度 > 上限
  → 保留前 maxChars 个字符
  → 追加明确的截断标记
```

截断标记不能只写 `...`，因为模型和用户无法判断这是原文符号还是 Harness 主动处理。

可以使用：

```text
…[输出过长，已截断]
```

### 4.4 为什么第一版保留开头

第一版使用头部截断：保留文本开头。

优点：

- 实现简单、确定性强。
- 网页标题、摘要、文档开头通常在前部。
- 测试容易。

局限：

- 重要结论可能在末尾。
- 日志错误可能出现在最后。
- 长文中间章节会丢失。

这只是 Harness 的最低保护。真实材料整理后续可以增加：

- 头尾保留。
- 分块读取。
- 分页工具。
- 摘要压缩。
- 让模型主动请求下一块内容。

但这些不属于第三课。

### 4.5 默认上限为什么是常量

定义：

```text
defaultMaxObservationChars = 8000
```

让工具执行入口有安全默认值，同时允许具体运行覆盖。

8000 字符不是精确 Token 预算，只是防止单次工具结果无限增长的第一道护栏。

## 5. 第二项能力：粗略估算 Token

### 5.1 为什么不能只统计消息数量

下面两组都是两条消息：

```text
User：你好
Assistant：你好
```

```text
User：请阅读下面 30,000 字材料
Assistant：这里是完整分析……
```

消息数量相同，但上下文成本完全不同。

因此除了消息条数，还需要内容规模指标。

### 5.2 第一版为什么用字符数估算

不同模型使用不同 Tokenizer。为了保持 Harness 模型无关，第一版不引入某一家模型的精确 Tokenizer，而是采用：

```text
大约 4 个字符 ≈ 1 Token
```

计算：

```text
所有消息 content 字符数
+ 所有 Tool Call arguments 字符数
÷ 4
向上取整
```

为什么 Tool Call 参数也要计入？

因为参数也会随 Assistant Message 发送给模型。例如一个工具调用可能携带很长查询或候选结构。

### 5.3 这个估算有什么局限

必须明确：`4 字符 ≈ 1 Token` 更接近英文粗估，对中文并不精确，可能明显低估。

因此这个函数的定位是：

```text
MVP 预算趋势指标
```

而不是：

```text
精确计费或严格上下文安全证明
```

生产阶段应考虑：

- 使用具体模型 Tokenizer。
- 读取模型响应中的真实 Usage。
- 对中文采用更保守系数。
- 为 System、工具定义和响应预留空间。
- 设置安全余量，而不是用满模型窗口。

这一课先实现现有测试约定的粗估算法，同时在设计上保留以后替换的可能。

### 5.4 为什么使用 `Math.ceil`

如果总字符数不能被 4 整除，向下取整会低估：

```text
5 个字符 / 4 = 1.25
```

预算保护应取 2，而不是 1，所以使用向上取整。

## 6. 第三项能力：裁剪消息窗口

### 6.1 第一版窗口按消息条数控制

定义默认值：

```text
defaultMaxMessages = 40
```

然后实现：

```text
pruneMessages(messages, maxMessages)
```

这个函数按消息数量裁剪，而不是直接根据 Token 删除。原因是第一版先建立确定、容易测试的消息边界语义。

之后可以组合使用：

```text
消息条数上限
+ Token 预算
+ 单工具输出上限
```

### 6.2 为什么 System Message 要优先保留

System Message 通常包含：

- Agent 身份。
- 工具使用规则。
- 输出协议。
- 安全边界。
- 材料整理目标。

如果裁剪时把 System Message 删除，后续模型可能失去任务规则。

因此第一版：

```text
先收集全部 system 消息
再从非 system 消息中保留最近部分
```

注意：如果 System Message 本身过长，单纯“永远保留”也会成为问题。后续应限制 System Prompt 大小，但不在这一课处理。

### 6.3 为什么保留最近消息

Agent 最近几轮通常包含当前任务状态：

- 最近一次工具调用。
- 最新观察。
- 模型刚刚形成的计划。
- 用户最近补充的要求。

所以第一版使用滑动窗口，优先保留尾部消息。

### 6.4 为什么简单 `slice(-N)` 会破坏工具链

完整工具往返通常是：

```text
Assistant
  toolCalls: [{ id: "call-1", name: "web-fetch", ... }]

Tool
  toolCallId: "call-1"
  content: "网页正文"
```

如果窗口刚好从 Tool Message 开始：

```text
Tool：网页正文
Assistant：根据网页内容……
```

模型看不到是谁、为什么调用了工具。

如果窗口只保留 Assistant Tool Call，不保留结果，也会形成未完成调用。

因此裁剪点必须位于一段完整对话的安全边界。

### 6.5 第一版如何寻找安全起点

步骤：

```text
1. 分离 system 与其他消息
2. 从其他消息尾部截取窗口
3. 检查截取结果的第一条消息
4. 如果第一条是 tool，丢弃
5. 如果第一条是携带 toolCalls 的 assistant，也丢弃
6. 继续检查，直到遇到安全起点
7. system + 安全尾部重新组合
```

为什么开头遇到携带 Tool Calls 的 Assistant 也要删除？

因为尾部裁剪可能没有保留它所对应的全部 Tool Result。最保守的做法是把这段工具往返一起舍弃。

### 6.6 一个裁剪示例

原始消息：

```text
1 System：你是材料整理 Agent
2 User：整理这个网页
3 Assistant：调用 web-fetch(call-1)
4 Tool(call-1)：网页正文
5 Assistant：整理完成
```

如果最多保留 4 条消息：

```text
System 占 1 条
非 System 只能取最后 3 条
```

初始尾部是：

```text
Assistant：调用 web-fetch(call-1)
Tool(call-1)：网页正文
Assistant：整理完成
```

因为第一条是携带 Tool Calls 的 Assistant，这段工具往返位于裁剪边界，第一版保守地移除 Assistant Tool Call 和随后开头的 Tool Message。

最终保留：

```text
System：你是材料整理 Agent
Assistant：整理完成
```

这损失了一部分上下文，但保证消息协议仍合法。

## 7. 为什么 `context.ts` 应该全部是纯函数

三个能力都可以写成：

```text
相同输入
  → 永远得到相同输出
  → 不访问网络
  → 不修改数据库
  → 不读取全局 Store
```

收益：

- 测试确定。
- 容易审查边界条件。
- 不依赖 React 或 Tauri。
- 可以在浏览器、桌面端和服务端复用。
- 后续替换算法不会影响调用方状态。

特别注意：`pruneMessages()` 不应该原地修改调用方传入的数组。

## 8. 你实际手写时的顺序

### 第一步：导入消息类型

`context.ts` 只需要 `AgentMessage`，并且它只参与类型检查，因此使用类型导入。

### 第二步：定义两个默认常量

```text
单次观察默认最大字符数
消息窗口默认最大条数
```

### 第三步：定义截断标记

标记只在本模块内部使用，不需要导出。

### 第四步：实现 `truncateObservation`

先写未超限路径，再写超限路径。

不要在这里处理 JSON，也不要知道结果来自哪个工具。

### 第五步：实现 `estimateTokens`

遍历消息：

```text
content.length
+ 每个 toolCall.arguments.length
```

最后除以 4 并向上取整。

### 第六步：实现 `pruneMessages`

顺序：

1. 未超过窗口时直接返回。
2. 分离 System Message。
3. 计算非 System 可用容量。
4. 获取最近消息。
5. 移除开头不完整工具链。
6. 返回重新组合的新数组。

### 第七步：运行测试

```bash
npm test -- --run src/tests/agent/context.test.ts
```

## 9. 测试覆盖了什么

### Observation 截断

- 未超限时原样返回。
- 超限时保留指定长度。
- 超限时附加明确标记。

### Token 粗估

- 普通消息内容计入。
- Tool Call 参数计入。
- 使用向上取整。

### 消息裁剪

- 未超限时不改变消息。
- System Message 得到保留。
- 最近消息得到保留。
- 返回长度不超过测试场景中的窗口。
- 不留下孤立 Tool Message。
- 不让窗口从携带 Tool Calls 的 Assistant 开始。

## 10. 常见错误

### 错误一：让每个具体工具自己截断

会造成策略分散和遗漏。具体工具可以做业务级分页，但 Harness 仍需要统一硬上限。

### 错误二：截断后不加标记

模型可能误以为看到的是完整材料，生成错误结论。

### 错误三：Token 估算只统计 `content`

Tool Call 参数同样会进入上下文。

### 错误四：把粗估结果当成精确计费

不同语言和模型 Tokenizer 差异很大，特别是中文。

### 错误五：直接使用 `messages.slice(-maxMessages)`

可能留下孤立 Tool Message，破坏模型消息协议。

### 错误六：裁剪函数原地修改数组

调用方可能还需要完整历史做 Trace 或持久化。Context 函数应返回新数组。

### 错误七：在 `context.ts` 中调用模型做摘要

这会让纯函数变成异步外部依赖，也会产生递归成本问题。摘要策略应作为更高层能力单独设计。

### 错误八：为了满足条数上限删除所有 System Message

可能导致模型失去安全规则。第一版优先保留 System，之后再单独控制 System Prompt 大小。

## 11. 第一版的已知边界

这一版能建立基础护栏，但还不是完整的生产级 Context Manager：

- 字符 Token 粗估对中文不准确。
- `pruneMessages()` 按消息条数，不按真实 Token 裁剪。
- 没有自动摘要。
- 没有对工具定义本身计算 Token。
- 没有为模型输出预留 Token。
- 没有按材料相关性选择上下文。
- 没有分块游标或分页读取协议。
- 没有将完整工具结果存外部、消息内只保留引用。
- 多个 System Message 超过窗口时没有额外压缩策略。

这些边界要记录下来，但不要阻止先完成一个可测试的 MVP。

## 12. 手写完成后的自检

- [ ] `context.ts` 只依赖 `AgentMessage` 类型。
- [ ] 三个核心函数都是纯函数。
- [ ] 单次工具观察有默认字符上限。
- [ ] 超长观察带明确截断标记。
- [ ] Token 粗估包含 Tool Call 参数。
- [ ] 估算使用向上取整。
- [ ] 未超窗口时消息保持不变。
- [ ] System Message 被优先保留。
- [ ] 最近消息被优先保留。
- [ ] 裁剪结果不从孤立 Tool Message 开始。
- [ ] 裁剪结果不从不完整 Assistant Tool Call 开始。
- [ ] 函数不原地修改消息数组。
- [ ] 能说明中文 Token 粗估的局限。
- [ ] Context 单文件测试通过。

## 13. 思考题

1. 如果 `web-fetch` 返回 100,000 字，为什么“模型支持 128K 上下文”仍不代表应该全部塞进去？
2. Observation 截断应该发生在具体工具、Tool Registry，还是 Model Client？为什么？
3. 为什么工具参数也会消耗 Token？
4. 如果裁剪后只留下 Tool Message，没有 Assistant Tool Call，模型可能如何处理？
5. 如果需要精确支持中文 Token 预算，你会把 Tokenizer 放在哪一层？
6. 如果 System Message 本身超过预算，第一版算法会怎样？后续可以怎么处理？
7. 为什么完整 Trace 可以保留所有消息，而发给模型的上下文只保留裁剪版本？
8. 长网页应该优先使用截断、分块、摘要还是检索？不同场景如何选择？

## 14. 参考 TS 源码

建议先根据前文独立手写，再对照下面的参考实现。

```ts
import type { AgentMessage } from './types'

export const defaultMaxObservationChars = 8000
export const defaultMaxMessages = 40

const truncationMarker = '\n…[输出过长，已截断]'

/** 单个工具观察结果的长度上限，防止一次取材撑爆上下文。 */
export function truncateObservation(text: string, maxChars = defaultMaxObservationChars): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}${truncationMarker}`
}

/**
 * 粗略估算（约 4 字符 1 Token），只用于第一版预算控制。
 * 该估算对中文并不精确，不能作为生产计费依据。
 */
export function estimateTokens(messages: AgentMessage[]): number {
  const chars = messages.reduce(
    (sum, message) =>
      sum + message.content.length + (message.toolCalls ?? []).reduce((inner, call) => inner + call.arguments.length, 0),
    0,
  )
  return Math.ceil(chars / 4)
}

/**
 * 消息窗口裁剪：保留全部 System Message 和最近的对话。
 * 截断点不能落在一次工具往返中间。
 */
export function pruneMessages(messages: AgentMessage[], maxMessages = defaultMaxMessages): AgentMessage[] {
  if (messages.length <= maxMessages) return messages

  const system = messages.filter((message) => message.role === 'system')
  const rest = messages.filter((message) => message.role !== 'system')
  const tail = rest.slice(Math.max(0, rest.length - (maxMessages - system.length)))

  let start = 0
  while (
    start < tail.length &&
    (tail[start].role === 'tool' || (tail[start].role === 'assistant' && tail[start].toolCalls?.length))
  ) {
    start += 1
  }

  return [...system, ...tail.slice(start)]
}
```

完成后运行：

```bash
npm test -- --run src/tests/agent/context.test.ts
```

测试通过后，先确认你能解释“为什么不能直接 `slice(-N)`”，再进入第四课 `permissions.ts`。
