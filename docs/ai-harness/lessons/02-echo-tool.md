# 第二课：用 `echo.ts` 建立第一个 Agent Tool

## 1. 这一课要完成什么

这一课只设计和手写一个文件：

```text
src/agent/tools/echo.ts
```

它是整个 Harness 的第一个工具，但不读取网页、不访问文件、不修改导图，也不依赖真实模型。

Echo 工具只完成一件事：接收一段文本，再把这段文本以结构化结果返回。

看起来很简单，但它会首次把第一课中的抽象类型落到一个真实对象上：

- `AgentTool<A>` 如何被具体工具实现。
- Zod Schema 如何定义工具输入边界。
- Schema 类型如何传给 TypeScript 泛型。
- 工具名称、描述和权限类别如何影响后续 Harness。
- 为什么工具执行函数接收的是已校验参数。
- 一个工具怎样做到确定性、无副作用、容易测试。

完成后，你应该能够回答：

1. 为什么不直接从 `web-fetch` 开始，而要先写 Echo？
2. Schema 校验和 `run()` 各自负责什么？
3. `z.infer<typeof echoSchema>` 解决了什么问题？
4. 工具名称和工具描述为什么属于运行协议，而不只是注释？
5. 为什么 Echo 被归为 `read`，即使它实际上没有读取外部资源？
6. 为什么 `run()` 返回对象而不是直接返回原字符串？

## 2. 开始真实工具之前，需要一根“测试探针”

材料整理 Agent 最终需要这些工具：

```text
web-fetch       读取网页正文
fs-list         查看文件夹内容
fs-read         读取文件
map-read        读取当前导图
branch-propose  生成思维树候选
```

如果直接从 `web-fetch` 开始，一旦测试失败，很难立即判断问题来自哪里：

- Tool Schema 是否正确？
- Tool Registry 是否正确解析了参数？
- 网络请求是否失败？
- URL 是否被安全策略拒绝？
- HTML 正文提取是否有问题？
- 工具输出是否被错误截断？
- Agent Loop 是否正确回填了 Tool Message？

一次引入太多变量，会让 Harness 的第一条链路很难定位问题。

因此先实现 Echo：

```text
输入 { text: "你好" }
  → 参数通过 Schema
  → run() 被调用
  → 返回 { echo: "你好" }
```

它没有以下变量：

- 网络。
- 文件系统。
- 数据库。
- HTML 解析。
- 用户权限。
- 随机值。
- 时间依赖。
- 外部服务状态。

这样后续建立 Tool Registry 和 Agent Loop 时，可以用 Echo 单独验证：

```text
模型是否生成了 Tool Call
  → 注册表是否找到正确工具
  → 参数是否被正确解析
  → run() 是否收到正确参数
  → 结果是否被序列化
  → Tool Message 是否回填给模型
```

Echo 相当于 Harness 工具链路中的“最小测试探针”。

## 3. Echo 在后续 Harness 中的位置

第二课暂时只实现右侧的工具对象：

```text
Agent Loop（第八课）
   │
   ▼
Tool Registry（第五课）
   │
   ├── 查找 echo
   ├── JSON.parse
   ├── echoSchema.safeParse
   │
   ▼
echoTool.run
   │
   ▼
{ echo: "..." }
```

这一课不会实现 Registry，也不会手动调用 `safeParse()`。这里只负责把工具声明完整。

## 4. 从需求一步步推导 Echo 工具

### 4.1 先明确输入协议

Echo 需要接收：

```json
{
  "text": "需要回显的文本"
}
```

为什么不直接接收一个字符串？

因为 Function Calling 的函数参数通常使用 JSON Object 描述。即使只有一个参数，也保留字段名，能够让模型和 JSON Schema 清楚理解参数语义。

同时，未来如果需要增加调试字段，也可以在对象协议上演进，而不需要把字符串协议整体推翻。

### 4.2 用 Zod 定义不可信输入的边界

模型可能生成：

```json
{}
```

也可能生成：

```json
{
  "text": ""
}
```

甚至：

```json
{
  "text": 123
}
```

因此需要 Schema 表达：

```text
输入必须是对象
  → 必须包含 text
  → text 必须是字符串
  → text 不能为空
  → text 最长 1000 个字符
```

得到的 Schema 形状是：

```ts
z.object({
  text: z.string().min(1).max(1000),
})
```

为什么限制最大长度？

Echo 本身不会造成严重风险，但它是所有真实工具的示范。如果第一个工具就没有输入预算，后续工具很容易延续“任何输入都接收”的习惯。

参数上限可以防止：

- 模型意外传入超长内容。
- 测试或日志被巨大参数污染。
- 后续 Tool Message 无意义地消耗上下文。

1000 不是永远正确的业务数字，它只是这个诊断工具的合理第一版边界。

### 4.3 Schema 同时服务运行时和 TypeScript

如果另外手写一个参数接口：

```ts
interface EchoArgs {
  text: string
}
```

就会同时存在两份定义：

```text
Zod Schema      运行时实际校验
EchoArgs        TypeScript 编译时类型
```

以后有人修改其中一个、忘记修改另一个，就可能发生漂移。

例如 Schema 改成 `message`，TypeScript 仍然认为字段叫 `text`。

所以通过：

```ts
z.infer<typeof echoSchema>
```

直接从 Schema 推导 TypeScript 参数类型。

这代表：

```text
Schema 是单一事实来源
  → 运行时用它校验
  → 编译时从它推导类型
```

### 4.4 把工具声明为 `AgentTool<A>`

第一课定义了：

```ts
interface AgentTool<A = unknown> {
  readonly name: string
  readonly description: string
  readonly category: ToolCategory
  readonly schema: ZodType<A>
  run(args: A, context: ToolContext): Promise<unknown>
}
```

Echo 的具体参数类型来自 Schema，所以工具声明为：

```text
AgentTool<z.infer<typeof echoSchema>>
```

这样 TypeScript 能检查：

- `schema` 是否能产出正确参数。
- `run()` 的 `args.text` 是否存在。
- `args.text` 是否是字符串。
- 工具实现是否满足通用 Agent Tool 接口。

### 4.5 工具名称是协议标识符

Echo 的名称定义为：

```text
echo
```

这个字符串以后会同时出现在：

- Function Calling 的工具列表。
- 模型生成的 Tool Call 中。
- Tool Registry 的 Map Key 中。
- Agent Trace 中。
- 测试断言中。

因此工具名称不是随便展示给用户的中文标题，而是稳定的协议标识符。

命名建议：

- 使用简短、明确的小写名称。
- 同一个 Harness 中保持一致的连接符风格。
- 不在名称中携带版本、环境或 UI 文案。
- 名称改变应视为协议变更。

### 4.6 工具描述会参与模型决策

模型看不到 `run()` 的源代码。它通常只能看到：

- 工具名称。
- 工具描述。
- 参数 JSON Schema。

因此描述不是普通代码注释，而是模型选择工具时的运行时上下文。

Echo 描述应该回答：

```text
它做什么？
模型什么时候应该使用？
它是否访问外部资源？
```

第一版保持简洁：说明它回显输入，并用于验证工具调用链路。

不应把描述写成：

```text
“这是一个非常强大的通用工具。”
```

这种描述没有选择信息，反而可能导致模型误用。

### 4.7 为什么类别是 `read`

Echo 没有真正读取网页或文件，但它满足 `read` 类工具的安全特征：

- 没有持久化副作用。
- 不修改导图。
- 不删除数据。
- 不发起外部操作。
- 可以由 Harness 自动执行。

当前 `ToolCategory` 没有专门的 `utility` 或 `diagnostic` 类。为了保持第一版权限模型简单，把 Echo 归入可自动执行的 `read`。

以后只有在权限策略真的需要区分时，才考虑增加类别，而不是为了语义完美提前扩张枚举。

### 4.8 `run()` 为什么是异步函数

Echo 可以同步返回结果，但统一工具接口要求：

```ts
Promise<unknown>
```

因为真实工具通常包含：

- 网络请求。
- 文件读取。
- 数据库查询。
- 用户审批等待。

如果 Echo 特殊使用同步接口，Tool Registry 就必须同时处理同步和异步返回，增加无意义分支。

把 Echo 也写成 `async run()`，可以让所有工具保持同一种执行方式。

### 4.9 为什么返回对象而不是原始字符串

Echo 最终返回：

```json
{
  "echo": "你好"
}
```

而不是直接返回：

```text
你好
```

返回对象可以验证 Tool Registry 后续的结果序列化逻辑：

```text
工具返回 JavaScript 对象
  → Registry JSON.stringify
  → 得到观察文本
  → 回填给模型
```

这比直接返回字符串多覆盖了一层真实工具常见行为。

## 5. Schema、Tool 和 Registry 的职责边界

这一课最重要的不是 Echo 功能本身，而是理解三个层次不能混在一起。

### Echo Schema 负责

- 描述参数结构。
- 拒绝空文本。
- 拒绝超长文本。
- 为 TypeScript 提供参数推导来源。

### Echo Tool 负责

- 声明名称、描述和权限类别。
- 接收已校验参数。
- 执行业务动作并返回结果。

### 后续 Tool Registry 负责

- 根据名称查找工具。
- 解析模型生成的 JSON 字符串。
- 调用 Schema 校验。
- 捕获工具异常。
- 序列化工具结果。
- 截断过长观察。

因此不要在 `echoTool.run()` 中重复写：

```text
判断 text 是否存在
判断 text 是否为字符串
判断 text 是否超过 1000
JSON.parse 模型参数
捕获并转换所有 Harness 错误
```

这些工作属于 Schema 或 Registry。

## 6. 你实际手写时的顺序

### 第一步：准备文件和导入

创建：

```text
src/agent/tools/echo.ts
```

需要导入：

- Zod 的运行时对象 `z`。
- 第一课定义的 `AgentTool` 类型。

注意：这里的 `z` 需要在运行时创建 Schema，所以不能使用 `import type`。

`AgentTool` 只参与类型检查，应使用类型导入。

### 第二步：定义并导出 Schema

Schema 需要导出，因为测试会直接验证边界，后续也可能用于生成 Function Calling 参数。

先只写：

```text
对象
  → text 字符串
  → 最少 1 字符
  → 最多 1000 字符
```

### 第三步：声明工具对象

使用 `AgentTool<z.infer<typeof echoSchema>>` 约束工具对象。

依次填写：

1. `name`
2. `description`
3. `category`
4. `schema`
5. `run`

### 第四步：实现 `run()`

只使用 `args.text` 构造结构化返回结果，不增加额外逻辑。

### 第五步：运行单文件测试

```bash
npm test -- --run src/tests/agent/tools/echo.test.ts
```

如果第一课的 `types.ts` 尚未手写完成，本测试会因为无法导入类型而失败。先完成第一课再运行。

## 7. 测试为什么要覆盖三个长度边界

Echo 测试至少验证：

```text
text = ""             应拒绝
text = 1000 个字符     应接受
text = 1001 个字符     应拒绝
```

这三个样本分别验证：

- 最小长度边界。
- 最大长度的闭区间。
- 超过最大长度后的拒绝行为。

测试还要直接执行 `echoTool.run()`，确认它返回预期对象。

这里不需要测试 JSON 解析、权限判断或异常捕获，因为那些属于后面的 Tool Registry。

## 8. 常见错误

### 错误一：只写 TypeScript 接口，不写 Zod Schema

TypeScript 类型在编译后不存在，无法校验模型运行时输入。

### 错误二：Schema 和参数接口分别维护

两份定义容易漂移。优先使用 `z.infer`。

### 错误三：在 `run()` 内再次校验参数

会让每个工具重复实现校验逻辑，破坏统一执行入口。

### 错误四：返回 `JSON.stringify(...)`

具体工具应返回业务结果对象。序列化属于 Tool Registry。

### 错误五：把 Echo 定义成 `proposal`

Echo 不生成需要用户确认的业务候选，不应进入候选审批语义。

### 错误六：描述写得过于宽泛

工具描述会影响模型路由。描述越含糊，模型越容易选错工具。

### 错误七：为了 Echo 单独修改通用 Tool 接口

Echo 应服从未来真实工具需要的统一异步接口，而不是让框架迁就最简单工具。

## 9. 手写完成后的自检

- [ ] 文件只实现一个 Echo 工具。
- [ ] `z` 使用普通导入，`AgentTool` 使用类型导入。
- [ ] Schema 是参数类型的单一事实来源。
- [ ] `text` 不能为空。
- [ ] `text` 最大长度为 1000。
- [ ] 工具名称稳定且与文件职责一致。
- [ ] 工具描述能够帮助模型判断用途。
- [ ] 工具类别是 `read`。
- [ ] `run()` 是异步函数。
- [ ] `run()` 不重复校验参数。
- [ ] `run()` 不负责 JSON 序列化。
- [ ] 工具没有网络、文件或持久化副作用。
- [ ] Echo 单文件测试通过。

## 10. 思考题

1. 如果 Echo 直接返回字符串，后面的 Tool Registry 测试会少覆盖哪一种能力？
2. 为什么工具名称应该稳定，而描述可以逐步优化？
3. 如果把 `max(1000)` 改成 `max(10000)`，这是协议变化、实现变化，还是业务配置变化？
4. 如果以后增加 `calculator`，它应该归为 `read`、`proposal`，还是新增类别？为什么？
5. 为什么 `AgentTool` 的 `schema` 和 `run()` 参数必须共享同一个泛型？
6. 如果模型传入 `{ "text": 123 }`，错误应该由 Echo、Schema 还是 Registry 处理？
7. Echo 没有读取外部信息，为什么暂时仍可归入 `read`？

## 11. 参考 TS 源码

建议先独立完成，再对照以下参考实现。

```ts
import { z } from 'zod'
import type { AgentTool } from '../types'

export const echoSchema = z.object({
  text: z.string().min(1).max(1000),
})

/** 里程碑 A 的联通性工具：验证“模型 → 工具 → 观察”链路，不访问任何外部资源。 */
export const echoTool: AgentTool<z.infer<typeof echoSchema>> = {
  name: 'echo',
  description: '回显输入文本。用于验证 Agent 工具调用链路是否正常。',
  category: 'read',
  schema: echoSchema,
  async run(args) {
    return { echo: args.text }
  },
}
```

完成后运行：

```bash
npm test -- --run src/tests/agent/tools/echo.test.ts
```

测试通过后，先确认自己能够解释 Schema、泛型、工具描述和权限类别的职责，再进入第三课 `context.ts`。
