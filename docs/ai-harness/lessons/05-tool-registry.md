# 第五课：用 `tool-registry.ts` 建立统一工具执行入口

## 1. 这一课要完成什么

这一课只设计和手写一个文件：

```text
src/agent/tool-registry.ts
```

这是前五课中第一个真正把多个基础模块连接起来的文件。它会使用：

- 第一课的工具、Tool Call 和 Tool Execution 类型。
- 第三课的 Observation 截断能力。
- 第四课的权限判断。
- 第二课的 Echo 工具作为测试样本。

它需要完成三个职责：

1. 注册、查找和列出工具。
2. 把工具 Schema 转换成模型可见的 Function Calling 描述。
3. 统一执行一次 Tool Call，并把任何结果转换成标准 `ToolExecution`。

完成后，你应该能够回答：

1. 为什么工具不能散落在 `if/else` 或 `switch` 中？
2. 为什么工具名称必须唯一？
3. Zod Schema 如何转换成模型使用的 JSON Schema？
4. 为什么权限判断要早于参数解析和工具执行？
5. 为什么模型参数必须经过 `JSON.parse` 和 Zod 两层处理？
6. 为什么工具错误不应该直接抛给 Agent Loop？
7. 为什么具体工具不负责序列化和 Observation 截断？
8. `denied` 与 `error` 在执行管线中的含义有何不同？

## 2. 项目需求背景：Agent 需要一个统一的工具总线

材料整理 Agent 后面会拥有多个工具：

```text
echo
web-fetch
fs-list
fs-read
map-read
branch-propose
```

模型返回 Tool Call 时只提供：

```text
工具名称
参数 JSON 字符串
调用 ID
```

例如：

```json
{
  "id": "call-17",
  "name": "web-fetch",
  "arguments": "{\"url\":\"https://example.com/article\"}"
}
```

Harness 必须回答：

```text
这个工具存在吗？
这个工具允许执行吗？
参数是合法 JSON 吗？
参数符合工具 Schema 吗？
工具执行成功了吗？
结果怎样转换成模型可读的 Observation？
结果是否过长？
执行用了多长时间？
```

如果没有 Tool Registry，这些逻辑很容易散落在 Loop 中：

```ts
if (call.name === 'web-fetch') {
  // 解析参数
  // 校验 URL
  // 执行
  // 捕获错误
} else if (call.name === 'fs-read') {
  // 再写一套解析、校验和错误处理
}
```

这样会导致：

- Loop 同时承担模型循环和工具细节。
- 每个工具拥有不同的错误语义。
- 某些工具忘记权限检查。
- 某些工具忘记 Schema 校验。
- 工具越多，条件分支越长。
- 工具难以独立测试和复用。

因此需要一个统一工具总线：

```text
Tool Registry
  → 保存工具目录
  → 向模型声明可用工具
  → 承担所有工具调用的统一入口
```

## 3. `tool-registry.ts` 在 Harness 中的位置

```text
ModelClient 返回 AgentToolCall
               │
               ▼
         ToolRegistry.get
               │
               ▼
     evaluateToolPermission
               │
               ▼
          JSON.parse
               │
               ▼
        tool.schema.safeParse
               │
               ▼
            tool.run
               │
               ▼
      序列化 + Observation 截断
               │
               ▼
          ToolExecution
               │
               ▼
       Loop 回填 Tool Message
```

这个文件是工具执行边界，但不是 Agent Loop：

- Registry 一次只处理一个 Tool Call。
- Loop 决定何时请求模型、执行多少轮。
- Loop 决定多个 Tool Call 采用串行还是并行。
- Registry 保证每次执行都经过同一条安全管线。

## 4. 第一部分：为什么需要 `ToolRegistry` 类

### 4.1 工具名称是查询键

模型不会持有 JavaScript 函数引用。它只会返回工具名称：

```text
web-fetch
```

因此 Harness 需要从名称找到真实对象：

```text
"web-fetch" → webFetchTool
```

最适合的数据结构是：

```ts
Map<string, AgentTool>
```

Map 的优点：

- 按名称查询清晰。
- 查询复杂度稳定。
- 可以检测重复名称。
- 保留注册顺序，方便向模型输出工具列表。

### 4.2 为什么工具名必须唯一

假设同时注册两个名为 `web-fetch` 的工具：

```text
工具 A：只访问公网
工具 B：允许访问内网
```

模型只会请求名称，Registry 无法知道应该执行哪一个。如果后注册工具静默覆盖前一个，还可能产生权限升级。

因此重复注册必须立即抛出开发期错误：

```text
工具 echo 已注册
```

这里为什么可以抛异常，而未知 Tool Call 不抛异常？

- 重复注册是程序配置错误，应在开发或启动阶段尽快暴露。
- 未知 Tool Call 是运行时模型决策错误，应转成 Observation 让循环继续。

两者处于不同错误层级。

### 4.3 Registry 的最小 API

第一版只需要：

```text
register(tool)  注册工具并返回 this
get(name)       按名称查询
list()          返回当前工具数组
```

`register()` 返回 `this`，允许：

```ts
new ToolRegistry()
  .register(echoTool)
  .register(webFetchTool)
```

同时提供便利函数：

```text
createToolRegistry(tools)
```

让业务层可以直接从一次任务所需工具数组创建注册表。

### 4.4 为什么不同任务可以拥有不同 Registry

不是所有 Agent 都应该看到所有工具。

例如材料整理任务可以拥有：

```text
web-fetch
fs-read
branch-propose
```

普通问答可能只需要：

```text
map-read
```

业务层通过注册表组装本次任务所需的最小工具集合，能够减少：

- 模型选错工具的概率。
- Prompt 中的工具描述长度。
- 不必要的权限暴露。

这也是最小权限原则的一部分。

## 5. 第二部分：把工具转换成 Function Calling 描述

### 5.1 模型看不到 `AgentTool` 对象

内部工具对象包含：

```text
name
description
category
schema
run
```

但发送给模型时不能传递 JavaScript 函数 `run()`，也没有必要把内部权限类别暴露为供应商字段。

模型真正需要：

```text
工具名称
工具描述
参数 JSON Schema
```

### 5.2 OpenAI 兼容结构

每个工具转换成：

```json
{
  "type": "function",
  "function": {
    "name": "echo",
    "description": "回显输入文本",
    "parameters": {
      "type": "object",
      "properties": {
        "text": {
          "type": "string"
        }
      },
      "required": ["text"]
    }
  }
}
```

### 5.3 为什么从 Zod 生成 JSON Schema

如果手写两份定义：

```text
Zod Schema       宿主程序校验参数
JSON Schema      模型理解参数
```

两者可能漂移。

例如模型看到参数叫 `query`，运行时却要求 `text`。

使用 Zod 4 的：

```ts
z.toJSONSchema(tool.schema)
```

让同一个 Schema 同时服务：

```text
模型工具声明
运行时参数校验
TypeScript 类型推导
```

### 5.4 `as const` 的作用

转换结果中的：

```ts
type: 'function' as const
```

确保 TypeScript 把它推断成字符串字面量 `'function'`，而不是宽泛的 `string`。

这对后续构造模型请求的类型兼容更友好。

## 6. 第三部分：统一执行一次 Tool Call

核心函数需要接收：

```text
registry
call
context
maxObservationChars
```

返回：

```text
Promise<ToolExecution>
```

### 6.1 为什么 Context 和 Observation 上限有默认值

不是每个调用方都需要取消信号，也不是每次运行都要自定义截断长度。

因此：

```text
context 默认空对象
maxObservationChars 默认使用 context.ts 常量
```

### 6.2 先建立统一完成函数

无论成功、拒绝还是失败，结果都包含：

```text
原始 Tool Call
状态
输出文本
执行耗时
```

可以在函数内部定义 `finish()`：

```text
finish(status, output)
  → 计算 durationMs
  → 返回 ToolExecution
```

这样所有分支使用同一结果形状，避免重复代码。

### 6.3 为什么要保存原始 Tool Call

`ToolExecution.call` 能让后续模块知道：

- 哪个工具被请求。
- 调用 ID 是什么。
- 模型原始参数是什么。

Trace、调试和 Tool Message 关联都会用到这些信息。

敏感工具上线后，Trace 展示参数前还需要脱敏；第一版先保留内部结构。

## 7. 固定执行顺序为什么重要

正确顺序：

```text
查找工具
  → 权限判断
  → JSON 解析
  → Schema 校验
  → 工具执行
  → 结果序列化
  → Observation 截断
```

不要随意交换顺序。

### 7.1 查找工具

根据 `call.name` 获取：

```text
AgentTool | undefined
```

### 7.2 权限判断

把查询结果交给第四课的：

```text
evaluateToolPermission(tool)
```

如果工具不存在或不允许：

```text
status = denied
output = 拒绝原因
```

立即返回，不再解析参数。

### 7.3 JSON 解析

Tool Call 中的 `arguments` 是原始字符串。

使用：

```ts
JSON.parse(call.arguments || '{}')
```

空字符串暂时按空对象处理，方便无参数工具。

解析失败：

```text
status = error
output = 工具参数不是合法 JSON
```

### 7.4 Zod Schema 校验

JSON 合法不代表参数合法：

```json
{
  "text": 123
}
```

它能通过 JSON.parse，但不能通过 Echo Schema。

使用：

```ts
tool.schema.safeParse(rawArgs)
```

为什么不用 `parse()`？

`parse()` 会抛异常，之后还要区分这是参数错误还是工具运行错误。

`safeParse()` 明确返回：

```text
success: true  + data
success: false + error
```

更适合统一执行管线。

### 7.5 将 Zod Issues 转成可读文本

模型需要知道哪个字段错了，例如：

```text
text: Too small
```

将每个 Issue 转为：

```text
字段路径: 错误信息
```

如果错误位于根对象，使用明确的根标记。

多个错误用分隔符连接。后续模型可以据此修正参数，而不是只收到“Validation Failed”。

### 7.6 执行 `tool.run()`

只有经过权限、JSON 和 Schema 三层检查后，才执行真实工具。

传入：

```text
parsed.data
context
```

具体工具得到的是可信类型参数，不再接触原始 JSON。

### 7.7 序列化工具结果

工具可能返回：

```text
string
object
array
number
boolean
```

规则：

```text
字符串 → 原样作为 Observation
其他值 → JSON.stringify
```

为什么不要求所有工具自己返回字符串？

具体工具应该返回自然业务结果，例如：

```ts
{ title, content, sourceUrl }
```

统一序列化属于 Harness 边界。

需要注意：`JSON.stringify(undefined)` 会得到 `undefined`，循环引用或 BigInt 也可能抛异常。参考实现会为 `undefined` 提供字符串兜底，并让其他序列化异常进入统一错误分支。

### 7.8 截断 Observation

序列化之后调用第三课的：

```text
truncateObservation
```

为什么在序列化后截断？

因为最终回填给模型的是字符串，需要限制的正是字符串长度。

### 7.9 捕获工具和序列化异常

把 `tool.run()`、序列化和截断放在同一个 `try/catch` 中。

任何异常转换成：

```text
status = error
output = 工具执行失败：具体原因
```

不向 Loop 继续抛出。

## 8. `denied`、`error` 和抛异常的边界

### `denied`

表示 Harness 明确不允许执行：

- 工具未注册。
- 工具权限不允许。

这不是工具自身失败，而是能力边界。

### `error`

表示允许尝试，但输入或执行失败：

- 非法 JSON。
- Schema 不匹配。
- 工具请求超时。
- 文件不存在。
- 序列化失败。

### 什么时候仍然可以抛异常

Registry 配置阶段的程序错误可以抛出，例如：

- 重复注册同名工具。

运行时单次 Tool Call 的可恢复问题应转成 `ToolExecution`。

## 9. 为什么错误要回填给模型

假设模型第一次调用：

```json
{
  "name": "echo",
  "arguments": "{\"text\":\"\"}"
}
```

Registry 返回：

```text
工具参数不符合要求：text: 字符串不能为空
```

Loop 把它作为 Tool Message 回填后，模型可以在下一轮修正：

```json
{
  "name": "echo",
  "arguments": "{\"text\":\"你好\"}"
}
```

这就是 Agent 相比固定流水线的重要特征：它可以观察执行结果并重新决策。

但要设置步数和工具调用预算，避免模型无限重试。该能力在后面的 Loop 中实现。

## 10. 耗时为什么属于 Tool Execution

工具耗时可以帮助发现：

- 哪个网页请求最慢。
- 文件读取是否异常。
- Agent 延迟主要来自模型还是工具。
- 是否需要超时、缓存或并行。

第一版使用：

```text
Date.now() - startedAt
```

它足以做毫秒级粗略观察。更严格的性能测量可以改用单调时钟，但不影响当前接口。

即使工具在同一毫秒完成，`durationMs = 0` 也是合法结果。

## 11. 你实际手写时的顺序

### 第一步：写依赖导入

需要：

- Zod 的运行时对象 `z`。
- Observation 默认上限和截断函数。
- 权限判断函数。
- 工具相关类型。

区分运行时导入与类型导入。

### 第二步：实现 `toFunctionCallingParams`

先完成最独立的纯转换：

```text
AgentTool[] → Function Calling tools
```

### 第三步：实现 `ToolRegistry`

依次写：

1. 私有 Map。
2. `register()`。
3. `get()`。
4. `list()`。

### 第四步：实现 `createToolRegistry`

遍历输入数组并注册，复用 `register()` 的重复检查。

### 第五步：写 `executeToolCall` 函数签名

先明确四个输入和异步返回类型，不急着写内部逻辑。

### 第六步：写计时和 `finish()`

让所有退出分支共享标准结果构造。

### 第七步：按固定顺序增加执行阶段

一次只增加一段：

1. 查找与权限。
2. JSON.parse。
3. Schema safeParse。
4. 工具执行。
5. 序列化和截断。
6. 异常转换。

### 第八步：运行测试

```bash
npm test -- --run src/tests/agent/tool-registry.test.ts
```

## 12. 测试覆盖了什么

### Registry 行为

- 重复名称被拒绝。
- 工具可以被查询和列出。

### Function Calling 转换

- `type` 为 `function`。
- 名称和描述正确。
- Zod Schema 被转换成 JSON Schema。

### 成功执行

- Echo 收到正确参数。
- 返回对象被序列化成 JSON 文本。
- 状态为 `ok`。
- 耗时大于或等于零。

### JSON 错误

- 非法 JSON 不进入 Schema 和工具执行。
- 返回 `error` Observation。

### Schema 错误

- 空文本等非法参数被拒绝。
- Observation 包含字段路径。

### 未注册工具

- 状态为 `denied`。
- 原因明确提到未注册。

### Observation 截断

- 超长工具结果按指定预算截断。
- 结果包含截断标记。

## 13. 常见错误

### 错误一：在 Loop 里用工具名称写 `switch`

会让 Loop 和具体工具耦合，无法形成通用 Harness。

### 错误二：重复注册时静默覆盖

可能产生不可见的行为变化和权限升级。

### 错误三：把 JSON.parse 当成完整参数校验

合法 JSON 仍可能字段缺失或类型错误。

### 错误四：直接使用 `schema.parse()` 且不区分错误

会把参数错误混入工具异常，不利于模型修正。

### 错误五：工具不存在时仍然解析参数

浪费处理，并模糊“未授权能力”和“参数错误”的边界。

### 错误六：具体工具自己 JSON.stringify

会导致每个工具返回格式不一致。

### 错误七：忘记截断错误输出

不仅成功结果可能很长，异常消息也可能携带大量下游内容。第一版参考实现主要截断成功结果，后续应考虑对所有 Observation 统一限制。

### 错误八：Catch 后返回空字符串

模型无法知道失败原因，也无法自我修正。

### 错误九：把所有异常继续抛给 Loop

一次文件不存在不应该让整个 Agent 立即崩溃。

### 错误十：在 Registry 中写材料整理业务

Registry 不应知道思维树、网页正文或候选节点结构。

## 14. 第一版的已知边界

当前 Tool Registry 还没有处理：

- 单工具超时。
- 重试与指数退避。
- 并行 Tool Call。
- 幂等键。
- 重复 Tool Call 检测。
- Tool Call 总预算。
- 参数和 Observation 脱敏。
- 工具版本。
- 工具级 Trace Span ID。
- MCP 工具动态同步。
- 工具结果结构与模型 Observation 的分离。
- `producesCandidate` 在执行结果中的显式传播。

这些能力可以在基础执行管线通过后逐步加入。

## 15. 手写完成后的自检

- [ ] 工具存储使用名称到工具对象的 Map。
- [ ] 重复工具名称会立即报错。
- [ ] Registry 支持注册、查询和列出工具。
- [ ] Function Calling 参数来自 Zod Schema。
- [ ] 所有运行时 Tool Call 经过统一执行函数。
- [ ] 权限判断早于参数解析和执行。
- [ ] 参数先经过 JSON.parse。
- [ ] 合法 JSON 再经过 Zod safeParse。
- [ ] 具体工具只接收校验后的参数。
- [ ] 未注册工具返回 `denied`。
- [ ] 参数或执行失败返回 `error`。
- [ ] 工具错误没有继续抛给 Loop。
- [ ] 对象结果统一序列化。
- [ ] `undefined` 结果有明确字符串兜底。
- [ ] 成功 Observation 经过长度截断。
- [ ] Tool Execution 包含耗时。
- [ ] Registry 中没有材料整理业务逻辑。
- [ ] Tool Registry 单文件测试通过。

## 16. 思考题

1. 重复注册为什么应该抛异常，而未知 Tool Call 为什么不应该抛异常？
2. 为什么 `JSON.parse` 与 Zod Schema 缺一不可？
3. 如果工具返回循环引用对象，错误应该在哪一层被处理？
4. 为什么 Tool Registry 一次只执行一个 Tool Call，而不负责整个多轮循环？
5. 如果一次模型响应包含三个只读 Tool Call，串行和并行各有什么风险？
6. 为什么成功结果和错误结果最终都要成为 Observation？
7. `proposal` 的 `producesCandidate` 应如何继续传递，才能形成真正安全闭环？
8. 如果将来接入 MCP，Tool Registry 的哪些接口可以继续复用？
9. 工具参数和 Observation 中可能有哪些敏感信息？应该在哪一层脱敏？

## 17. 参考 TS 源码

建议先根据前文独立手写，再对照下面的参考实现。

```ts
import { z } from 'zod'
import { defaultMaxObservationChars, truncateObservation } from './context'
import { evaluateToolPermission } from './permissions'
import type { AgentTool, AgentToolCall, ToolContext, ToolExecution } from './types'

/** 工具定义转换成 OpenAI 兼容的 Function Calling 参数。 */
export function toFunctionCallingParams(tools: AgentTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema),
    },
  }))
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>()

  register(tool: AgentTool): this {
    if (this.tools.has(tool.name)) throw new Error(`工具 ${tool.name} 已注册`)
    this.tools.set(tool.name, tool)
    return this
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name)
  }

  list(): AgentTool[] {
    return [...this.tools.values()]
  }
}

export function createToolRegistry(tools: AgentTool[]): ToolRegistry {
  const registry = new ToolRegistry()
  for (const tool of tools) registry.register(tool)
  return registry
}

/**
 * 执行一次 Tool Call 的唯一入口：
 * 权限 → JSON 解析 → Schema 校验 → 运行 → 序列化 → 截断。
 */
export async function executeToolCall(
  registry: ToolRegistry,
  call: AgentToolCall,
  context: ToolContext = {},
  maxObservationChars = defaultMaxObservationChars,
): Promise<ToolExecution> {
  const startedAt = Date.now()

  const finish = (status: ToolExecution['status'], output: string): ToolExecution => ({
    call,
    status,
    output,
    durationMs: Date.now() - startedAt,
  })

  const tool = registry.get(call.name)
  const permission = evaluateToolPermission(tool)
  if (!permission.allowed || !tool) {
    return finish('denied', permission.reason ?? '工具不可用')
  }

  let rawArgs: unknown
  try {
    rawArgs = JSON.parse(call.arguments || '{}')
  } catch {
    return finish('error', '工具参数不是合法 JSON')
  }

  const parsed = tool.schema.safeParse(rawArgs)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(根)'}: ${issue.message}`)
      .join('；')
    return finish('error', `工具参数不符合要求：${issues}`)
  }

  try {
    const result = await tool.run(parsed.data, context)
    const serialized = typeof result === 'string' ? result : JSON.stringify(result)
    const observation = serialized ?? String(result)
    return finish('ok', truncateObservation(observation, maxObservationChars))
  } catch (error) {
    return finish('error', `工具执行失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
```

完成后运行：

```bash
npm test -- --run src/tests/agent/tool-registry.test.ts
```

测试通过后，先尝试不用看代码画出完整执行顺序，再进入第六课 `model-client.ts`。
