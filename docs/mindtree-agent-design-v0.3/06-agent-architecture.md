# Agent 架构、权限与后续协作工作流

## 1. 第一阶段形态

第一阶段不是持续自主运行的 Agent，而是受控的结构化 AI 能力：

```text
用户触发
→ 本地构建有限上下文
→ 模型生成候选
→ 本地校验
→ 用户审查
→ 领域命令写入
```

## 2. 权限分级

| 能力 | 默认权限 |
| --- | --- |
| 读取当前节点/子树 | 用户触发后自动 |
| 读取有限目标候选 | 用户触发后自动 |
| 分类与生成候选 | 自动 |
| 生成差异预览 | 自动 |
| 新增、更新、完成节点 | 用户确认 |
| 移动、合并或删除节点 | 第一版不支持 |
| 整理整张导图 | 使用现有独立预览流程 |

## 3. 上下文策略

不要每次发送整张导图。上下文分三部分：

1. 源上下文：当前节点或子树的完整语义信息。
2. 路由上下文：少量候选文档与候选节点。
3. 历史上下文：已应用指纹、最近相关检查点或摘要。

上下文构建应为独立模块并可单元测试，不能继续把逻辑全部堆在 `AiAssistant.tsx`。

建议模块：

```text
src/ai/deposit/
├── deposit-context.ts
├── deposit-prompt.ts
├── deposit-schema.ts
├── deposit-parser.ts
├── deposit-dedup.ts
├── deposit-planner.ts
└── deposit-types.ts
```

## 4. Prompt 职责

系统提示应明确：

- 只识别输入中有依据的内容。
- 区分事实、推测、计划和决策。
- 优先更新已有节点，避免重复创建。
- 找不到目标就返回空 ID。
- 不把普通叙述全部提升为长期知识。
- 不输出执行成功声明。
- 只返回符合协议的 JSON。

## 5. 安全边界

- API Key 沿用当前本地配置，不进入导图、备份和模型上下文。
- 附件二进制不发送。
- 发送前界面应说明范围。
- 所有模型输出视为不可信输入。
- 用户确认之后仍要执行本地校验。
- 模型不得选择输入列表之外的 ID。
- 原始记录不可被 AI 覆盖或删除。

## 6. 智能协作状态机（后续阶段）

智能沉淀稳定后，增加可选协作会话：

```ts
type WorkflowMode = 'explore' | 'decide' | 'deliver'

type WorkflowPhase =
  | 'context'
  | 'understanding'
  | 'modeling'
  | 'validation'
  | 'criteria'
  | 'execution'
  | 'review'
  | 'deposit'
  | 'completed'
```

不要要求所有模式经过同样步骤：

- 探索：理解 → 建模 → 用户复述/验证 → 结论。
- 决策：目标与约束 → 候选 → 比较 → 决策记录。
- 交付：交付物与验收 → 拆解 → 执行 → 自检 → 用户验收。

## 7. 阶段检查点

检查点结构：

```ts
type WorkflowCheckpoint = {
  id: string
  confirmed: string[]
  rejected: string[]
  constraints: string[]
  openQuestions: string[]
  nextActions: string[]
  sourceNodeIds: string[]
  createdAt: number
}
```

检查点首先保存在协作会话中；其中适合长期保留的部分再进入智能沉淀候选，不直接全部写入树。

## 8. 模式识别

未来可以由 Agent 建议模式，但用户可覆盖：

- “为什么、如何理解、区别”倾向探索。
- “选哪个、比较、取舍”倾向决策。
- “实现、修改、生成、完成”倾向交付。

模式识别不应阻止用户输入，也不应在低置信度时强制切换。

## 9. MCP 方向

现有 MCP 已支持列出、读取、搜索和预览追加分支。后续可增加：

- `mindtree_analyze_deposit`：只生成候选，不写入。
- `mindtree_list_deposit_batches`：读取待审查批次。
- `mindtree_preview_deposit_plan`：生成差异预览。
- `mindtree_apply_deposit_plan`：必须带版本和显式确认参数。

但 UI 内部功能不应依赖 MCP；领域服务应可被 UI 和 MCP 共同复用。

