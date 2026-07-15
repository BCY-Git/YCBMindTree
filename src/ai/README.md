# MindTree AI 工程索引

这里是 MindTree 的 AI 功能主目录。新增的 AI 上下文、提示词、结构化协议、解析、协作流程和沉淀逻辑应优先维护在这里，方便集中审查。

## 核心链路

```text
用户操作
  → AiAssistant / QuickAssistant / GhostNoteEditor
  → 上下文与提示词构建
  → platform/tauri.ts 发起模型请求
  → schema / parser 校验模型输出
  → 生成候选与差异预览
  → 用户确认
  → domain/commands 或 persistence/database 执行写入
```

关键边界：模型输出始终是候选内容，不能绕过解析、预览和确认直接改写导图。

## 审查入口

| 关注点 | 主要文件 | 审查重点 |
|---|---|---|
| AI 总编排 | `AiAssistant.tsx` | 请求意图、上下文选择、预览确认、命令写入 |
| 快速问答 | `QuickAssistant.tsx` | 临时会话与本地记忆 |
| 幽灵续写 | `ghost-completion.ts`、`GhostNoteEditor.tsx` | 上下文范围、取消请求、插入行为 |
| 分支生成 | `generated-branch.ts` | 模型 JSON 到节点剪贴板结构的校验 |
| 全图整理 | `map-reorganization.ts` | 移动计划校验，不允许模型直接执行 |
| 智能沉淀 | `deposit/` | 来源、去重、候选、规划、确认写入、指标 |
| 智能协作 | `workflow/` | 模式、阶段、检查点与长期资产 |
| 模型配置 | `ai-settings.ts` | 端点、模型与本地密钥设置 |

## 目录职责

### `deposit/`

- `deposit-context.ts`：构建焦点子树、路径和工作区上下文。
- `deposit-prompt.ts`：限定模型只生成结构化沉淀候选。
- `deposit-schema.ts` / `deposit-parser.ts`：验证外部模型输出。
- `deposit-dedup.ts`：识别已处理或可能重复的内容。
- `deposit-planner.ts`：把用户接受的候选转换为可预览操作。
- `DepositInbox.tsx`：用户检查、修改和接受候选的界面。
- `deposit-metrics.ts`：记录生成、接受、重复、写入与撤销效果。

### `workflow/`

- `workflow-types.ts`：探索、决策、交付模式及阶段状态。
- `workflow-service.ts`：模式判断与会话初始化。
- `workflow-schema.ts`：阶段检查点协议与解析。
- `workflow-asset.ts`：决策记录和知识卡等长期资产。
- `WorkflowPanel.tsx`：协作状态及检查点操作界面。

## 跨目录边界

下列文件有意保留在 AI 目录之外：

- `src/platform/tauri.ts`：统一的桌面运行时和网络能力边界。
- `src/domain/commands.ts`：所有导图修改的可撤销命令边界。
- `src/persistence/database.ts`：会话、候选、来源与指标的持久化边界。

AI 模块可以调用这些边界，但不应在组件内复制网络、命令或数据库实现。

## 维护规则

1. 新的模型输出必须先定义 schema，再编写 parser 和异常样本测试。
2. 提示词、类型、解析和测试放在同一功能目录，避免散落到页面组件。
3. AI 只能自动读取和生成候选；修改、重组、删除和跨文档写入必须保留确认步骤。
4. 测试至少覆盖正常输出、缺失字段、非法目标和重复内容。
5. `AiAssistant.tsx` 只负责流程编排；某段逻辑形成独立协议后应下沉到对应目录。
6. 修改重要 AI 链路时，同步更新本索引的“审查入口”和核心链路。
