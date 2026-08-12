# 第六课：用 `model-client.ts` 隔离模型供应商协议

## 1. 这一课要完成什么

这一课只设计和手写一个文件：

```text
src/agent/model-client.ts
```

它是 Harness 与真实模型服务之间的协议适配层，主要完成四件事：

1. 把 Harness 内部消息转换成 OpenAI Chat Completions 兼容消息。
2. 把内部工具定义转换后放入模型请求。
3. 把不同形式的模型响应归一化成统一 `ModelResponse`。
4. 隔离网络请求、供应商错误和协议差异，不让 Agent Loop 理解厂商字段。

这一课不会执行任何工具，也不会运行多轮循环。模型客户端只负责“发送消息”和“解释模型响应”。

完成后，你应该能够回答：

1. 为什么 Agent Loop 不应该直接读取 `choices[0].message`？
2. 内部消息协议与 OpenAI Wire Protocol 有什么区别？
3. Function Calling 是“模型执行函数”还是“模型表达调用意图”？
4. 为什么原生 `tool_calls` 应优先于文本降级协议？
5. 为什么模型响应必须以 `unknown` 进入归一化函数？
6. 文本工具协议解决什么兼容问题，又带来什么风险？
7. 为什么模型客户端接收 `AgentTool[]`，却不负责执行工具？
8. `AbortSignal` 为什么要从 Loop 一直传到网络请求？

## 2. 项目需求背景：MindTree 不能被某一家模型绑死

MindTree 允许用户配置 OpenAI Chat Completions 兼容端点，例如：

- OpenAI。
- DeepSeek。
- 通义等兼容服务。
- 本地或自托管的兼容网关。

这些服务通常拥有相似的请求结构，但仍可能存在差异：

- 有的端点支持原生 `tool_calls`。
- 有的端点只支持普通文本。
- 有的端点把工具参数返回为 JSON 字符串。
- 有的兼容端点可能返回对象形式参数。
- 错误响应结构可能不同。
- 空内容可能表现为 `null`、缺失字段或空字符串。
- 模型能力、上下文长度和 Tool Calling 稳定性不同。

如果 Agent Loop 直接写成：

```ts
const response = await fetch(...)
const message = response.choices[0].message
if (message.tool_calls) {
  // 执行工具
}
```

会产生三个问题。

### 问题一：Loop 被供应商协议污染

Loop 应该只关心：

```text
模型返回最终文本了吗？
模型请求工具了吗？
```

它不应该知道 `choices`、`function.arguments` 等 Wire 字段。

### 问题二：无法使用确定性假模型测试

如果 Loop 自己发网络请求，就必须在循环测试中 Mock Fetch 和完整 HTTP 响应，测试会变得脆弱。

### 问题三：更换协议会影响所有核心模块

一旦供应商字段变化，Loop、Trace、工具系统都可能跟着修改。

因此需要一个适配层：

```text
供应商 Wire Protocol
  ↕ model-client.ts
Harness 内部协议
```

## 3. `model-client.ts` 在 Harness 中的位置

```text
Agent Loop
   │
   │ AgentMessage[] + AgentTool[]
   ▼
ModelClient.chat
   │
   ├── 转换 Wire Message
   ├── 转换 Function Calling Tools
   ├── requestAiChat
   └── 解析供应商响应
   │
   ▼
ModelResponse
├── content
└── AgentToolCall[]
   │
   ▼
Agent Loop 决定完成或交给 Tool Registry
```

依赖方向：

```text
model-client.ts
├── 依赖 platform/tauri.ts 的统一模型网络出口
├── 依赖 tool-registry.ts 的工具描述转换
└── 依赖 types.ts 的内部协议
```

它不依赖：

- React。
- MindTree Store。
- `src/ai/ingest` 业务 Prompt。
- 具体网页或文件工具。
- Agent Loop 的实现。

## 4. 先区分三套数据结构

这一课最容易混淆三种消息。

### 4.1 Harness 内部消息

第一课定义的：

```ts
interface AgentMessage {
  role: AgentRole
  content: string
  toolCalls?: AgentToolCall[]
  toolCallId?: string
}
```

这是 Loop、测试和 Trace 共同理解的模型无关结构。

### 4.2 Wire Message

发送到 OpenAI 兼容端点的结构：

```text
role
content
tool_calls?
tool_call_id?
```

字段使用供应商约定的蛇形命名。

### 4.3 归一化模型响应

模型客户端最终返回：

```ts
interface ModelResponse {
  content: string
  toolCalls: AgentToolCall[]
}
```

Loop 从此不再接触 Wire Message。

## 5. 第一部分：定义最小 Wire Message

### 5.1 为什么在本文件定义局部类型

Wire Message 只在模型适配层使用，不应该放进全局 `types.ts`。

如果全局暴露供应商字段，其他模块可能开始依赖它，破坏模型无关边界。

因此定义本地、不导出的：

```text
WireMessage
```

### 5.2 Tool Call 的 Wire 结构

内部 Tool Call：

```ts
{
  id,
  name,
  arguments,
}
```

发送给模型时转换成：

```json
{
  "id": "call-1",
  "type": "function",
  "function": {
    "name": "echo",
    "arguments": "{\"text\":\"你好\"}"
  }
}
```

这里的 `type: 'function'` 是 Wire Protocol 约定，不属于内部 Tool Call。

### 5.3 Tool Message 的关联

模型请求工具后，Harness 会把执行结果作为 Tool Message 回填：

```json
{
  "role": "tool",
  "content": "{\"echo\":\"你好\"}",
  "tool_call_id": "call-1"
}
```

`tool_call_id` 必须与原 Tool Call ID 对应，否则模型无法判断结果属于哪次调用。

## 6. 推导内部消息转换函数

需要一个本地函数：

```text
AgentMessage → WireMessage
```

基本步骤：

```text
1. 复制 role 和 content
2. 如果存在 toolCalls，转换成 tool_calls
3. 如果存在 toolCallId，转换成 tool_call_id
4. 返回新的 Wire Message
```

为什么返回新对象，而不是直接修改内部消息？

- 内部消息还要用于 Trace 和最终结果。
- Wire 字段与内部字段命名不同。
- 避免供应商字段污染内部状态。
- 纯转换更容易测试和审查。

第一版不会在这里验证角色与字段组合。例如普通 User Message 理论上不应携带 Tool Calls。正确组合由 Loop 构造；后续可以增加协议校验测试。

## 7. Function Calling 的真实含义

Function Calling 不表示模型真的调用了 JavaScript 函数。

真实流程：

```text
应用把工具名称、描述和 JSON Schema 发给模型
  → 模型生成“我想调用哪个工具、参数是什么”
  → 应用解析 Tool Call
  → 应用检查权限和参数
  → 应用执行真实工具
  → 应用把结果回填模型
```

模型客户端只负责前两步的协议转换，不执行 `tool.run()`。

### 为什么请求中只有存在工具时才添加 `tools`

如果当前任务没有工具，就不发送空工具数组：

- 请求更简洁。
- 避免兼容端点对空 `tools` 行为不一致。
- 普通文本模型也能继续使用。

工具定义来自第五课的：

```text
toFunctionCallingParams(tools)
```

## 8. 第二部分：解析文本工具降级协议

### 8.1 为什么需要降级协议

有些 OpenAI 兼容端点：

- 不支持 `tools`。
- 忽略工具定义。
- 只能生成普通文本。
- Tool Calling 稳定性不足。

为了让这些模型仍能表达工具意图，业务 Prompt 可以要求模型输出：

```json
{
  "action": "web-fetch",
  "input": {
    "url": "https://example.com"
  }
}
```

模型客户端把它转换成内部 `AgentToolCall`，Loop 后面的流程保持不变。

### 8.2 解析函数的输入输出

```text
输入：模型 content 字符串

成功：
{ name, input }

不是工具动作或解析失败：
null
```

### 8.3 为什么容忍 Markdown Code Fence

模型可能输出：

````text
```json
{"action":"echo","input":{"text":"hi"}}
```
````

所以先去除首尾 Code Fence，再尝试解析。

这里只处理包裹整个响应的简单围栏，不试图从长篇自然语言中提取任意 JSON。这能降低误判概率。

### 8.4 为什么先检查首字符

如果内容不是以 `{` 开始，大概率是普通最终回答，没有必要调用 `JSON.parse()`。

这只是快速路径，不是安全判断。真正结果仍需要 Try/Catch。

### 8.5 工具动作的最小有效条件

只有：

```text
action 是非空字符串
```

才视为工具调用。

`input` 缺失时暂时使用空对象，支持无参数工具。

### 8.6 文本协议的误判风险

如果模型的最终答案刚好是：

```json
{
  "action": "总结结果",
  "input": {}
}
```

它可能被误判为工具调用。

降低风险的方法：

- 业务 Prompt 明确工具动作格式。
- 工具名称采用已注册名称。
- Tool Registry 会拒绝未知工具。
- 后续可以要求额外协议字段或严格枚举。
- 原生 Tool Calls 始终优先。

文本协议只是兼容降级，不应比原生协议拥有更高信任级别。

## 9. 第三部分：归一化模型响应

需要导出一个纯函数：

```text
normalizeModelMessage(message: unknown): ModelResponse
```

测试可以直接用各种异常对象验证它，不需要发真实网络请求。

### 9.1 为什么输入是 `unknown`

模型响应来自网络，TypeScript 接口无法保证运行时数据真的符合声明。

使用 `unknown` 迫使代码逐项判断：

- `content` 是否是字符串。
- `tool_calls` 是否是数组。
- 工具名称是否存在。
- 参数是字符串还是对象。

如果直接断言成完整类型，异常兼容端点可能在运行时崩溃。

### 9.2 先处理 Content

规则：

```text
content 是字符串 → 使用原值
其他情况         → 空字符串
```

纯 Tool Call 响应可能没有文本内容，因此空字符串是合法内部表示。

### 9.3 解析原生 `tool_calls`

只有 `tool_calls` 是数组时才遍历。

对每一项：

```text
读取 function.name
  → 不是非空字符串：过滤

读取 id
  → 合法非空字符串：使用
  → 缺失：生成本地 ID

读取 function.arguments
  → 字符串：保留
  → 对象或其他值：JSON.stringify
  → 缺失：序列化空对象
```

为什么过滤没有名称的调用？

没有名称就无法在 Registry 中查找工具。保留这种条目只会制造无意义错误。

### 9.4 原生 Tool Calls 优先

模型可能同时返回：

```text
content 中包含文本 JSON 动作
tool_calls 中包含原生调用
```

必须优先使用原生 Tool Calls，因为：

- 它是结构化供应商协议。
- 有明确 Tool Call ID。
- 与 Tool Message 关联更可靠。
- 文本内容可能只是解释或重复。

### 9.5 没有原生调用时再尝试文本降级

如果解析到文本动作，把它包装为内部 Tool Call：

```text
id         本地生成
name       action
arguments  JSON.stringify(input)
```

同时把归一化 `content` 设为空字符串，避免后续既把动作当文本又执行工具。

### 9.6 普通文本作为最终回答

没有原生 Tool Calls，也没有文本动作时：

```ts
{
  content,
  toolCalls: [],
}
```

Loop 看到空 Tool Calls，就会把 Content 当作最终回复。

## 10. 本地 Tool Call ID 的作用和局限

文本协议没有供应商 Tool Call ID，但后面的 Tool Message 必须关联一次调用。

第一版使用模块内计数器生成：

```text
text-action-1
text-action-2
```

这能保证同一页面进程内的基本唯一性。

已知局限：

- 页面刷新后重新计数。
- 并发任务共享计数器。
- 不适合作为持久化全局 ID。

后续可以改用：

- 任务 ID + 步数 + 调用序号。
- `crypto.randomUUID()`。
- 由 Loop 注入 ID Factory。

第一版 ID 只用于消息关联和测试，不承担业务主键职责。

## 11. 第四部分：生产模型客户端配置

需要定义：

```text
OpenAiModelClientOptions
```

包含：

### `endpoint`

完整 Chat Completions 地址。

安全校验不在本文件重复实现，而由 `platform/tauri.ts` 的 `requestAiChat()` 统一处理，例如拒绝私网和不安全地址。

### `model`

用户配置的模型标识。

### `apiKey`

请求第三方模型服务所需 Key。

模型客户端不负责持久化 Key，也不应把 Key 写入 Trace。

### `temperature`

可选。未提供时使用较低默认值，让材料整理和工具选择更稳定。

## 12. 推导 `OpenAiModelClient.chat()`

### 12.1 构造基础请求

请求包含：

```text
model
temperature
messages
```

消息通过内部转换函数生成 Wire Message。

### 12.2 有工具时添加工具定义

```text
tools.length > 0
  → request.tools = toFunctionCallingParams(tools)
```

模型客户端只发送声明，不执行工具。

### 12.3 使用统一网络出口

调用：

```text
requestAiChat(endpoint, request, apiKey, signal)
```

这样：

- 浏览器开发环境可以走同源代理。
- Tauri 桌面端可以走原生 HTTP。
- Endpoint 安全检查集中维护。
- Loop 的取消信号能传到底层请求。

### 12.4 读取响应 Body

先尝试解析 JSON，失败时使用空对象兜底。

为什么即使 HTTP 失败也要读 Body？

模型供应商通常会在错误 Body 中返回更具体原因，例如余额不足、模型不存在或速率限制。

### 12.5 HTTP 失败

如果 `response.ok` 为 false：

```text
优先使用 payload.error.message
否则使用 HTTP 状态兜底
```

这里抛出模型请求异常。后面的 Agent Loop 会把 Model Client 异常转换成整个运行的 `failed` 状态。

为什么模型请求失败和工具请求失败处理不同？

- 工具失败可以作为 Observation 回填给模型继续决策。
- 模型本身失败时，没有模型可以继续决策，所以本次 Loop 只能失败或由更高层重试/降级。

### 12.6 提取第一条模型消息

第一版读取：

```text
choices[0].message
```

如果缺失，抛出明确错误，而不是让 Loop 收到空响应并误判为正常完成。

最后交给：

```text
normalizeModelMessage(message)
```

## 13. 为什么 `ModelClient` 易于测试

第一课定义的最小接口是：

```ts
interface ModelClient {
  chat(messages, tools, signal): Promise<ModelResponse>
}
```

生产客户端实现真实 HTTP。

后面的 `ScriptedModelClient` 可以按脚本返回：

```text
第一次：请求 echo
第二次：返回最终文本
```

它们对 Loop 来说完全相同。

这是依赖倒置：

```text
Loop 依赖 ModelClient 抽象
生产 HTTP 和测试假模型分别实现抽象
```

## 14. Function Calling 与 MCP 的边界

这节实现的是模型侧 Function Calling 协议：

```text
模型如何表达“我要调用工具”
```

MCP 解决的是工具提供和连接标准：

```text
Host 如何发现、连接和调用外部 Tool Server
```

未来 MCP 工具仍可以被转换成 `AgentTool`，再由当前 Model Client 作为 Function Calling Tools 发给模型。

二者互补，不是替代关系。

## 15. 你实际手写时的顺序

### 第一步：写依赖导入

需要：

- `requestAiChat`。
- `toFunctionCallingParams`。
- 内部消息、工具、Tool Call、Model Client 和 Model Response 类型。

### 第二步：先写文本协议纯函数

实现：

```text
parseTextProtocolAction
```

它与网络无关，容易先测试。

### 第三步：定义局部 `WireMessage`

只描述当前转换真正需要的字段，不把完整供应商 SDK 类型复制进来。

### 第四步：实现内部消息转换

依次处理：

1. Role 和 Content。
2. Tool Calls。
3. Tool Call ID。

### 第五步：实现响应归一化

顺序：

```text
读取 content
  → 解析原生 tool_calls
  → 原生调用存在则立即返回
  → 尝试文本动作
  → 否则返回普通文本
```

### 第六步：定义客户端配置

写清 Endpoint 是完整地址，Temperature 为可选。

### 第七步：实现 `OpenAiModelClient`

依次完成：

1. 保存配置。
2. 构造 Request。
3. 可选添加 Tools。
4. 调用统一网络出口。
5. 解析错误 Body。
6. 检查 HTTP 状态。
7. 提取 Message。
8. 调用归一化函数。

### 第八步：运行测试

```bash
npm test -- --run src/tests/agent/model-client.test.ts
```

当前测试重点验证纯解析与归一化，不会发真实网络请求。

## 16. 测试覆盖了什么

### 文本协议

- 标准 JSON 动作可以解析。
- Markdown JSON Code Fence 可以解析。
- 普通文本返回 `null`。
- 缺少 Action 的 JSON 返回 `null`。

### 原生 Tool Calls

- 原生调用优先于 Content 中的文本动作。
- 对象形式 Arguments 被转换成 JSON 字符串。
- 没有工具名的调用被过滤。

### 文本降级归一化

- 没有原生调用时，文本动作转成内部 Tool Call。
- Input 被序列化成 Arguments 字符串。

### 普通最终回复

- 没有任何工具动作时，保留 Content。
- Tool Calls 返回空数组。

## 17. 常见错误

### 错误一：让 Loop 直接处理 `choices`

会让核心循环依赖 OpenAI Wire Protocol。

### 错误二：把网络响应直接断言成可信类型

兼容端点异常字段会在运行时破坏代码。

### 错误三：Content 中有 JSON 就一律视为工具调用

正常结构化答案也可能是 JSON。至少要求非空 Action，并只解析完整 JSON 响应。

### 错误四：文本动作优先于原生 Tool Calls

会丢失供应商提供的结构化 ID 和调用信息。

### 错误五：在 Model Client 中执行工具

会把模型适配、权限和工具执行混为一层。

### 错误六：每次都发送空 `tools`

部分兼容端点可能不接受或错误处理空工具列表。

### 错误七：不传 `AbortSignal`

用户点击取消后，网络请求仍会持续占用资源。

### 错误八：HTTP 失败时忽略响应 Body

用户只能看到模糊状态码，无法定位模型配置问题。

### 错误九：缺少 Message 时返回空文本

Loop 会把异常响应误判为正常完成。

### 错误十：在 Trace 中记录 API Key

模型凭据不能进入日志、消息历史或错误详情。

## 18. 第一版的已知边界

当前 Model Client 还没有处理：

- 流式文本 Delta。
- 流式 Tool Call Arguments 拼接。
- 精确 Usage 和 Token 计费。
- 多 Choice 选择。
- 模型能力矩阵。
- 自动模型路由。
- 429/5xx 重试和指数退避。
- 熔断和备用模型降级。
- 请求级 Trace ID。
- Prompt/模型版本记录。
- JSON Mode 和 Structured Output。
- 文本协议严格版本号。
- Tool Call ID 的跨任务全局唯一性。
- 对不同兼容端点的专用 Adapter。

第一版先保证同步、非流式 Tool Calling 能进入统一 Harness 协议。

## 19. 手写完成后的自检

- [ ] Model Client 与 Tool Registry 职责分离。
- [ ] Loop 不需要理解 `choices` 和 `tool_calls` Wire 字段。
- [ ] Wire Message 类型只存在于模型适配层。
- [ ] 内部 Tool Calls 能正确转换成供应商结构。
- [ ] Tool Message 携带正确的 `tool_call_id`。
- [ ] 文本协议只解析完整 JSON 动作。
- [ ] 原生 Tool Calls 优先于文本降级。
- [ ] 网络响应以 `unknown` 进入归一化逻辑。
- [ ] 非字符串 Content 安全转换为空字符串。
- [ ] 无工具名的调用会被过滤。
- [ ] 对象 Arguments 会被序列化。
- [ ] 普通文本返回空 Tool Calls。
- [ ] 没有工具时不发送 `tools` 字段。
- [ ] `AbortSignal` 传入统一网络出口。
- [ ] HTTP 错误尽量保留供应商消息。
- [ ] 缺失模型 Message 时明确失败。
- [ ] API Key 不进入消息和 Trace。
- [ ] Model Client 单文件测试通过。

## 20. 思考题

1. 为什么 Function Calling 并不意味着模型直接执行了函数？
2. 如果一个模型同时返回 Content 和 Tool Calls，Loop 应怎样理解 Content？
3. 为什么文本降级协议比原生 Tool Calls 更容易误判？
4. 如果端点把 Arguments 返回为对象，为什么归一化层要将它重新转成字符串？
5. 模型 HTTP 请求失败时，为什么不能像工具失败一样回填给同一个模型继续决策？
6. 如果以后增加 Anthropic 专用协议，哪些模块应该修改，哪些模块不应该修改？
7. 流式 Tool Calls 为什么需要增量拼接 Arguments？
8. Function Calling 与 MCP 分别解决哪一侧的问题？
9. 如何让文本协议 Tool Call ID 在并发任务中更稳定？

## 21. 参考 TS 源码

建议先根据前文独立手写，再对照下面的参考实现。

```ts
import { requestAiChat } from '../platform/tauri'
import { toFunctionCallingParams } from './tool-registry'
import type { AgentMessage, AgentTool, AgentToolCall, ModelClient, ModelResponse } from './types'

/**
 * 文本降级协议：端点不支持原生 Function Calling 时，
 * 模型在 Content 中输出 {"action":"工具名","input":{...}}。
 */
export function parseTextProtocolAction(content: string): { name: string; input: unknown } | null {
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (!text.startsWith('{')) return null

  try {
    const parsed = JSON.parse(text) as { action?: unknown; input?: unknown }
    if (typeof parsed.action !== 'string' || !parsed.action.trim()) return null
    return { name: parsed.action.trim(), input: parsed.input ?? {} }
  } catch {
    return null
  }
}

type WireMessage = {
  role: string
  content: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

function toWireMessage(message: AgentMessage): WireMessage {
  const wire: WireMessage = {
    role: message.role,
    content: message.content,
  }

  if (message.toolCalls?.length) {
    wire.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: {
        name: call.name,
        arguments: call.arguments,
      },
    }))
  }

  if (message.toolCallId) wire.tool_call_id = message.toolCallId
  return wire
}

let textActionCounter = 0

/** 把兼容端点的模型消息归一化成 Harness 内部 ModelResponse。 */
export function normalizeModelMessage(message: unknown): ModelResponse {
  const raw = (message ?? {}) as { content?: unknown; tool_calls?: unknown }
  const content = typeof raw.content === 'string' ? raw.content : ''

  const toolCalls: AgentToolCall[] = Array.isArray(raw.tool_calls)
    ? raw.tool_calls.flatMap((item, index) => {
        const call = item as {
          id?: unknown
          function?: { name?: unknown; arguments?: unknown }
        }

        const name = typeof call.function?.name === 'string' ? call.function.name.trim() : ''
        if (!name) return []

        return [
          {
            id: typeof call.id === 'string' && call.id ? call.id : `call-${index}`,
            name,
            arguments:
              typeof call.function?.arguments === 'string'
                ? call.function.arguments
                : JSON.stringify(call.function?.arguments ?? {}),
          },
        ]
      })
    : []

  if (toolCalls.length) return { content, toolCalls }

  const action = parseTextProtocolAction(content)
  if (action) {
    textActionCounter += 1
    return {
      content: '',
      toolCalls: [
        {
          id: `text-action-${textActionCounter}`,
          name: action.name,
          arguments: JSON.stringify(action.input),
        },
      ],
    }
  }

  return { content, toolCalls: [] }
}

export interface OpenAiModelClientOptions {
  /** 完整 Chat Completions 地址。 */
  endpoint: string
  model: string
  apiKey: string
  temperature?: number
}

/** 通过 MindTree 统一网络出口访问 OpenAI 兼容端点。 */
export class OpenAiModelClient implements ModelClient {
  constructor(private readonly options: OpenAiModelClientOptions) {}

  async chat(
    messages: AgentMessage[],
    tools: AgentTool[],
    signal?: AbortSignal,
  ): Promise<ModelResponse> {
    const request: Record<string, unknown> = {
      model: this.options.model,
      temperature: this.options.temperature ?? 0.3,
      messages: messages.map(toWireMessage),
    }

    if (tools.length) request.tools = toFunctionCallingParams(tools)

    const response = await requestAiChat(
      this.options.endpoint,
      request,
      this.options.apiKey,
      signal,
    )

    const payload = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: unknown }>
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new Error(payload.error?.message || `模型请求失败（${response.status}）`)
    }

    const message = payload.choices?.[0]?.message
    if (message === undefined) throw new Error('模型没有返回内容。')
    return normalizeModelMessage(message)
  }
}
```

完成后运行：

```bash
npm test -- --run src/tests/agent/model-client.test.ts
```

测试通过后，先确认你能从头画出“内部消息 → Wire Message → 模型响应 → ModelResponse”的双向适配流程，再进入第七课 `trace.ts`。
