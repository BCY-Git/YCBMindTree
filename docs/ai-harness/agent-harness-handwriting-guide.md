# MindTree Agent Harness 手写实施指南

## 1. 目标

本指南用于从零手写 MindTree 的 Agent Harness 内核。完成前八步后，应得到一个模型无关、工具可扩展、过程可观测、行为可中断的基础 Agent 运行时。

这一阶段只实现 Harness，不实现材料整理业务、UI、MCP、RAG、长期记忆或多 Agent。

目标调用链：

```text
用户消息
  → ModelClient 请求模型
  → 模型返回文本或 Tool Call
  → ToolRegistry 校验并执行工具
  → 工具结果作为观察回填模型
  → 继续循环或返回最终答案
```

## 2. 手写纪律

1. 严格按照本文顺序实现，不一次写完全部文件。
2. 每完成一个文件，先运行对应测试，再进入下一步。
3. 模型输出、工具名和工具参数全部视为不可信输入。
4. 工具执行失败应转换成模型可读取的观察，不应直接炸掉整个循环。
5. Agent 只能读取信息或生成候选，不拥有直接修改导图的能力。
6. Trace 只记录可审计的决策、动作、结果和指标，不记录模型隐藏思维链。
7. 暂时不要查看 `output/agent-harness-reference-20260811/` 中的旧实现；遇到无法独立解决的阻塞时再用于核对。

## 3. 目录范围

本阶段只需要创建和修改：

```text
src/agent/
├── types.ts
├── context.ts
├── permissions.ts
├── tool-registry.ts
├── model-client.ts
├── trace.ts
├── loop.ts
└── tools/
    └── echo.ts
```

验收测试位于：

```text
src/tests/agent/
```

## 4. 第一步：定义内部协议 `types.ts`

详细课程、推导过程和参考源码见：[`lessons/01-types.md`](./lessons/01-types.md)。

### 目标

先定义 Harness 内部各模块共同使用的类型，让模型客户端、工具系统、循环和 Trace 依赖同一套协议。

### 需要定义的概念

- Agent 消息角色：`system`、`user`、`assistant`、`tool`。
- Agent 内部消息。
- 模型请求的工具调用。
- 工具类别。
- 工具执行上下文。
- Agent 工具接口。
- 工具执行状态和执行结果。
- Agent 运行事件。
- Agent 运行状态和最终结果。
- 统一模型响应。
- 模型客户端接口。

### 设计约束

- 内部消息协议不能直接依赖某一家模型供应商的 SDK 类型。
- 工具参数在进入注册表校验前保留为原始 JSON 字符串。
- 工具类别只允许 `read` 和 `proposal`，不定义 `write`。
- 工具接口必须携带 Zod Schema。
- 工具执行上下文应能传递 `AbortSignal`。
- Agent 事件必须足够支撑 UI Trace 和测试断言。

### 完成标准

- 其他 Harness 文件可以只依赖 `types.ts` 描述自己的输入和输出。
- 类型中不存在绕过确认、直接写入导图的工具类别。
- 暂时不在本文件实现任何运行逻辑。

## 5. 第二步：实现最小工具 `tools/echo.ts`

详细课程、推导过程和参考源码见：[`lessons/02-echo-tool.md`](./lessons/02-echo-tool.md)。

### 目标

实现一个不访问网络、不读取文件、没有副作用的 Echo 工具，用它验证“模型调用工具 → 工具返回观察”的最小链路。

### 需要实现

- Echo 参数的 Zod Schema。
- 非空字符串和最大长度约束。
- 工具名称与清晰描述。
- `read` 工具类别。
- 异步 `run()` 方法。

### 设计约束

- 工具描述要明确说明用途，避免模型误选。
- `run()` 只返回结构化回显结果，不访问外部状态。
- 参数合法性由 Schema 表达，不在 `run()` 内重复实现一套校验。

### 验收

```bash
npm test -- --run src/tests/agent/tools/echo.test.ts
```

通过后再进入第三步。

## 6. 第三步：实现上下文管理 `context.ts`

详细课程、推导过程和参考源码见：[`lessons/03-context.md`](./lessons/03-context.md)。

### 目标

建立最基础的上下文预算能力，防止一次工具输出或长期消息历史无限撑大模型上下文。

### 需要实现

#### 工具观察截断

- 输入未超限时原样返回。
- 输入超限时保留前半部分并添加明确截断标记。
- 默认上限与调用方自定义上限分离。

#### Token 粗略估算

- 根据消息字符数估算 Token。
- 工具调用参数也要计入预算。
- 这里只做预算保护，不追求供应商级精确计费。

#### 消息窗口裁剪

- 保留 System 消息。
- 保留最近的对话消息。
- 不得让裁剪点落在一次工具往返中间。
- 不留下孤立的 Tool Message。
- 不留下缺少结果的 Assistant Tool Call。

### 验收

```bash
npm test -- --run src/tests/agent/context.test.ts
```

## 7. 第四步：实现权限判断 `permissions.ts`

详细课程、推导过程和参考源码见：[`lessons/04-permissions.md`](./lessons/04-permissions.md)。

### 目标

将工具权限策略集中到一个纯函数中，避免权限判断散落在循环或具体工具里。

### 需要实现

- 未注册工具拒绝执行，并返回可理解的原因。
- `read` 工具允许执行。
- `proposal` 工具允许运行，但标记其结果是候选。

### 设计约束

- 不新增 `write`、`delete` 或类似自动写入类别。
- 权限函数不执行工具，不访问 UI，也不修改状态。
- 未来扩展工具类别时，必须同时更新权限测试。

### 验收

```bash
npm test -- --run src/tests/agent/permissions.test.ts
```

## 8. 第五步：实现工具注册与执行 `tool-registry.ts`

详细课程、推导过程和参考源码见：[`lessons/05-tool-registry.md`](./lessons/05-tool-registry.md)。

### 目标

建立所有工具调用的唯一执行入口，统一处理注册、参数校验、权限、异常和观察结果。

### 需要实现

#### 工具注册表

- 按工具名称注册。
- 拒绝重复名称。
- 支持按名称查询。
- 支持列出当前工具。
- 支持从工具数组创建注册表。

#### Function Calling 描述转换

- 把 Agent 工具转换为 OpenAI 兼容的 Function Calling 定义。
- 使用工具自身的 Zod Schema 生成 JSON Schema。

#### 工具执行管线

执行顺序应为：

```text
查找工具
  → 权限判断
  → JSON 参数解析
  → Zod Schema 校验
  → 执行 tool.run
  → 结果序列化
  → 观察结果截断
  → 返回结构化执行结果
```

### 错误语义

- 未注册工具：`denied`。
- 参数不是合法 JSON：`error`。
- 参数不符合 Schema：`error`，并提供字段级提示。
- 工具自身抛出异常：`error`，转换为观察文本。
- 任何以上错误都不应从执行入口继续向外抛出。

### 验收

```bash
npm test -- --run src/tests/agent/tool-registry.test.ts
```

## 9. 第六步：实现模型客户端 `model-client.ts`

详细课程、推导过程和参考源码见：[`lessons/06-model-client.md`](./lessons/06-model-client.md)。

### 目标

隔离模型供应商的 Wire Protocol，为 Agent Loop 提供统一、稳定的 `ModelResponse`。

### 需要实现

#### 内部消息转换

- 普通消息转换为 OpenAI Chat Completions 兼容格式。
- Assistant Tool Call 转为 `tool_calls`。
- Tool Message 携带对应 `tool_call_id`。

#### 原生 Function Calling 解析

- 读取响应中的 `tool_calls`。
- 过滤缺少工具名的非法调用。
- 缺少调用 ID 时生成稳定的本地 ID。
- 参数为对象时转换为 JSON 字符串。

#### 文本协议降级

当模型端点不支持原生 Function Calling 时，允许解析类似下面的纯 JSON 动作：

```json
{
  "action": "工具名称",
  "input": {}
}
```

普通文本不能被误判为工具调用。

#### 生产模型请求

- 接收模型端点、模型名、API Key 和温度参数。
- 通过 `platform/tauri.ts` 的统一网络出口发送请求。
- 传递 `AbortSignal`。
- HTTP 失败和非法模型响应提供明确错误。

### 设计约束

- 原生 `tool_calls` 的优先级高于文本降级协议。
- Loop 不应知道 OpenAI Wire Message 的具体字段。
- 不在模型客户端执行工具。

### 验收

```bash
npm test -- --run src/tests/agent/model-client.test.ts
```

## 10. 第七步：实现轨迹记录 `trace.ts`

详细课程、推导过程和参考源码见：[`lessons/07-trace.md`](./lessons/07-trace.md)。

### 目标

将 Agent Loop 发出的结构化事件转换为用户和开发者可查看的中文执行摘要。

### 需要记录

- 当前开始第几步。
- 模型选择了哪个工具。
- 工具成功、拒绝或失败。
- 工具耗时和观察结果长度。
- 模型最终完成。
- 达到步数预算后终止。

### 设计约束

- Trace 由 Agent Event 驱动，不侵入 Loop 的业务逻辑。
- 每条记录包含步骤、事件类型、摘要和时间戳。
- 最终文本过长时只显示摘要。
- 不记录模型隐藏思维链。
- 暂时只保存在内存，不做数据库持久化。

### 完成标准

- `AgentTracer.handle` 可以直接传给 Loop 的 `onEvent`。
- Loop 测试能通过 Trace 摘要判断执行顺序。

本步骤会在第八步的 Loop 测试中一起验收。

## 11. 第八步：实现 Agent 循环 `loop.ts`

详细课程、推导过程和参考源码见：[`lessons/08-loop.md`](./lessons/08-loop.md)。

### 目标

完成 Harness 最核心的状态循环，让模型能够多轮调用工具，并根据工具观察继续决策。

### 输入

- `ModelClient`。
- `ToolRegistry`。
- 初始消息。
- 最大步骤数。
- 单次工具观察长度上限。
- `AbortSignal`。
- 可选事件回调。

### 循环流程

```text
复制初始消息，避免修改调用方数组
  → 检查 AbortSignal
  → 发出 step-start
  → 请求模型
  → 模型没有 Tool Call：记录最终回复并完成
  → 模型包含 Tool Call：保存 Assistant Message
  → 逐个执行工具
  → 发出 tool-call 和 tool-result
  → 将每个结果作为 Tool Message 回填
  → 进入下一轮
  → 达到最大步数：发出 budget-exceeded 并停止
```

### 必须覆盖的运行结果

- `completed`：模型返回最终文本。
- `budget-exceeded`：达到最大步骤数。
- `aborted`：用户取消。
- `failed`：模型客户端调用失败。

### 设计约束

- 工具失败只是一次观察，循环仍可继续。
- 模型客户端失败才让本次运行进入 `failed`。
- 每个 Tool Message 必须携带对应的 Tool Call ID。
- 所有关键动作都要发出 Agent Event。
- 循环本身不包含“材料整理”业务提示词。

### 验收

```bash
npm test -- --run src/tests/agent/loop.test.ts
```

## 12. 阶段验收

完成前八步后，运行 Harness 全部测试：

```bash
npm test -- --run src/tests/agent
```

当前阶段目标：

```text
Test Files  6 passed
Tests       33 passed
```

同时人工确认：

- `src/agent/` 内没有 MindTree 材料整理提示词。
- `src/agent/` 内没有直接写入导图的代码。
- Loop 不依赖 React 组件。
- 工具参数都经过 Schema 校验。
- 工具错误都能回填给模型。
- 用户取消和最大步骤数都能终止循环。
- Trace 可以还原 Agent 的动作顺序。

## 13. 完成后再做什么

Harness 验收通过后，再进入材料整理业务：

1. `src/agent/tools/web-fetch.ts`
2. `src/agent/tools/branch-propose.ts`
3. `src/ai/ingest/ingest-schema.ts`
4. `src/ai/ingest/ingest-prompt.ts`
5. `src/ai/ingest/ingest-service.ts`
6. `src/ai/ingest/IngestPanel.tsx`

在 Harness 通过之前，不提前增加 MCP、RAG、长期记忆、多 Agent 或复杂 UI。
