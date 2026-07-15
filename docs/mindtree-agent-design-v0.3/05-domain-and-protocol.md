# 领域模型与 AI 协议

## 1. 架构约束

沿用 0.2.2 的分层：

```text
UI → Editor Store → Command Executor → Domain → Persistence
```

AI 不得直接修改 `document.nodes`。所有写入必须转成领域命令，并继承校验、历史和持久化能力。

## 2. 建议的独立持久化表

智能沉淀过程不建议全部塞入 `MindMapDocument`。建议 Dexie 新增：

```ts
type DepositBatch = {
  id: string
  sourceDocumentId: string
  sourceNodeIds: string[]
  scope: 'node' | 'subtree' | 'document'
  sourceDocumentUpdatedAt: number
  status: 'generating' | 'pending' | 'applied' | 'failed'
  candidates: DepositCandidate[]
  createdAt: number
  updatedAt: number
  appliedAt: number | null
}

type DepositCandidateType =
  | 'fact'
  | 'result'
  | 'task'
  | 'problem'
  | 'decision'
  | 'knowledge'
  | 'idea'

type DepositAction =
  | 'keep'
  | 'create'
  | 'update'
  | 'complete'
  | 'append-note'

type DepositCandidate = {
  id: string
  batchId: string
  type: DepositCandidateType
  title: string
  detail: string
  sourceNodeIds: string[]
  suggestedDocumentId: string | null
  suggestedParentId: string | null
  suggestedTargetNodeId: string | null
  action: DepositAction
  confidence: number
  reason: string
  duplicateOfCandidateId: string | null
  status: 'pending' | 'accepted' | 'ignored' | 'applied' | 'failed'
  fingerprint: string
}
```

具体 Dexie schema version 由实现 Agent 根据现有 `database.ts` 设计迁移，但必须覆盖旧数据库升级测试。

## 3. 来源追踪

建议独立记录，不侵入普通节点显示：

```ts
type DepositProvenance = {
  id: string
  batchId: string
  candidateId: string
  sourceDocumentId: string
  sourceNodeIds: string[]
  sourceSnapshot: string
  targetDocumentId: string | null
  targetNodeIds: string[]
  action: DepositAction
  model: string
  acceptedByUser: boolean
  createdAt: number
}
```

`sourceSnapshot` 保存精简文本，不保存整个文档副本。

## 4. 发送给模型的上下文

上下文应包括：

```ts
type DepositAnalysisContext = {
  source: {
    documentId: string
    title: string
    categoryId: string
    rootId: string
    selectedNodeIds: string[]
    nodes: Array<{
      id: string
      path: string[]
      topic: string
      note: string
      taskStatus: MindNodeTaskStatus
      priority: MindNodePriority
      dueDate: string | null
      marks: NodeMark[]
      tagNames: string[]
    }>
  }
  destinations: Array<{
    documentId: string
    title: string
    categoryName: string
    candidateNodes: Array<{ id: string; path: string[]; topic: string }>
  }>
  alreadyAppliedFingerprints: string[]
}
```

不要发送附件二进制、API Key、无关工作区数据。目标候选数量应有上限。

## 5. 模型输出协议

模型只返回候选，不返回执行结果：

```json
{
  "summary": "本次识别到项目进展、未解决问题和后续任务",
  "candidates": [
    {
      "type": "problem",
      "title": "得分计算与行为不匹配",
      "detail": "分数 bug 尚未完全修复，需要继续验证。",
      "sourceNodeIds": ["source-node-id"],
      "action": "create",
      "suggestedDocumentId": "provided-document-id",
      "suggestedParentId": "provided-parent-id",
      "suggestedTargetNodeId": null,
      "confidence": 0.91,
      "reason": "原文明确表示问题尚未修复"
    }
  ]
}
```

协议要求：

- `type`、`action` 使用固定枚举。
- 所有 ID 必须来自输入上下文，否则解析失败或置空。
- `confidence` 范围 0 到 1，仅用于排序和提示，不作为自动写入依据。
- 每个候选必须引用至少一个源节点。
- 单次候选建议上限 20。
- 标题建议不超过 160 字。

## 6. 结构校验

新增 `deposit-analysis.schema.ts`，使用 Zod：

- JSON 结构校验。
- 枚举校验。
- 长度和数量上限。
- ID 白名单校验在解析后的领域层完成。
- 非法目标 ID 置空并标记需要用户选择，不得猜测替换。

## 7. 应用协议

AI 候选经用户编辑后转换为应用计划：

```ts
type ApplyDepositPlan = {
  batchId: string
  expectedDocumentVersions: Record<string, number | string>
  operations: DepositOperation[]
}

type DepositOperation =
  | { type: 'CREATE_BRANCH'; documentId: string; parentId: string; branch: MindNodeClipboard }
  | { type: 'UPDATE_NODE'; documentId: string; nodeId: string; patch: { topic?: string; note?: string } }
  | { type: 'COMPLETE_TASK'; documentId: string; nodeId: string; evidence: string }
  | { type: 'APPEND_NODE_NOTE'; documentId: string; nodeId: string; content: string }
```

应用前必须再次验证目标、版本、重复状态和命令合法性。

## 8. Command 设计

同一文档可新增：

```ts
{ type: 'APPLY_DEPOSIT_OPERATIONS'; operations: LocalDepositOperation[] }
```

命令执行要求：

- 先在克隆文档上顺序执行全部操作。
- 任一操作失败则整个命令失败。
- 成功后只产生一份历史记录。
- 返回新增或更新的节点 ID。

跨文档由工作区服务协调多个文档和 Dexie 事务，不能直接塞进单文档 Store 命令。

## 9. Schema 版本

沉淀批次和来源使用独立表时，不必立刻修改 `MindMapDocument.schemaVersion`。若为节点增加永久来源字段，则应评估 schema 迁移并补充导入、导出、备份、同步和 MCP 兼容测试。

优先选择独立表，降低第一版对核心文档格式的侵入。

