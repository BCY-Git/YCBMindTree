# MindTree Agent 使用说明（给 AI 的接口手册）

> 读者是 **AI agent**，不是人类用户。人类负责审阅产出；agent 负责读取、分析、生成结构化写入提案。
> 协议细节见 [server-and-mcp.md](./server-and-mcp.md)；本文是操作手册。

## 0. 连接

```text
POST {服务地址}/mcp        Streamable HTTP，会话头 Mcp-Session-Id
Authorization: Bearer <token>   ← 本地开发 token 或账号会话 token
```

- 本地开发：`http://127.0.0.1:8787/mcp`，token 在 `apps/mindtree-server/.env` 的 `MINDTREE_DEV_TOKEN`
- 生产：`http://106.54.44.45:18789/mcp`
- 身份由 token 决定（开发 token = `local-user`）；**不要**自己构造 ownerId
- Claude Code 接入：`claude mcp add --transport http mindtree <url> --header "Authorization: Bearer <token>"`；Pi：写入 `~/.config/mcp/mcp.json`

## 1. 数据模型速览

一份导图（document）= 扁平节点字典 + 根指针：

```jsonc
{
  "id": "uuid", "rootId": "uuid", "version": 12, "title": "…",
  "nodes": {
    "<id>": {
      "parentId": "uuid|null", "childIds": ["…"],   // 树结构
      "topic": "主题文字", "note": "备注",
      "taskStatus": "none|todo|doing|done", "priority": 0, "dueDate": "YYYY-MM-DD|null",
      "marks": ["flag|star|risk|idea"], "tagIds": ["…"],
      "collapsed": false, "isFreeTopic": false
    }
  }
}
```

`version` 是乐观锁：每次写入后 +1，所有写操作必须携带读到的 `baseVersion`。

## 2. 工具清单与用途

| 工具 | 类型 | 什么时候用 |
|---|---|---|
| `mindtree_list_documents` | 读 | 第一步：列出导图摘要（id、标题、version），选定目标 |
| `mindtree_get_document` | 读 | 读完整树结构（含 version），大导图先用它再裁剪 |
| `mindtree_search_nodes` | 读 | 按关键词/标签/标记/任务状态/优先级/沉淀来源定位节点 |
| `mindtree_analyze_deposit` | 读 | 读取一个受限子树，作为「沉淀分析」的输入（最多 80 节点） |
| `mindtree_append_branch` | 写 | **向节点挂一棵子树**；默认 dryRun，只预览不写入 |
| `mindtree_preview_deposit_plan` | 写(暂存) | 提交沉淀候选，生成待确认批次（不改导图） |
| `mindtree_apply_deposit_plan` | 写 | 用户确认后，凭一次性令牌应用沉淀批次 |
| `mindtree_list_deposit_batches` | 读 | 查看待审/已应用的沉淀批次 |

## 3. 标准工作流

### 3.1 往导图里加内容（最常用）

```text
list_documents → get_document（记下 version 和目标节点 id）
→ append_branch { dryRun: true }   ← 先预览
→ 把预览呈现给用户确认
→ append_branch { dryRun: false, baseVersion }  ← 用户同意后写入
```

`branch` 参数是**递归树**，一次调用建出完整层级：

```json
{
  "documentId": "…", "parentNodeId": "…", "dryRun": false, "baseVersion": 12,
  "branch": {
    "topic": "合成操作流程",
    "children": [
      { "topic": "前置条件", "children": [
        { "topic": "角色达到 Lv10 后开放", "children": [] },
        { "topic": "必须位于赛丽亚房间内", "children": [] }
      ]},
      { "topic": "操作步骤", "children": [
        { "topic": "材料栏放入碎片 → 点击合成", "children": [] },
        { "topic": "等待 10 秒倒计时结束", "children": [] }
      ]}
    ]
  }
}
```

**层级质量要求（重要）**：
- ❌ 不要把要点平铺成一个节点里的大段文字或一层扁平列表
- ✅ 按语义分组建 2-4 层：分类节点 → 要点 → 支撑细节
- 每个 topic ≤ 20 字，是短语不是句子；解释性长文放 `note`
- 单分支上限 60 节点 / 6 层；超了就拆成多次 append

**冲突处理**：返回 `VERSION_CONFLICT` 时重新 `get_document`，基于新 `version` 和新结构重试；不要强行覆盖。

### 3.2 从过程记录沉淀知识

```text
analyze_deposit { documentId, sourceNodeId }          ← 读受限子树
→ preview_deposit_plan { baseVersion, candidates[] }   ← 不改导图，返回 batchId + confirmationToken
→ 把 changes 呈现给用户核对
→ apply_deposit_plan { batchId, confirmationToken, confirmed: true }
```

- 候选动作：`keep`（保留）/ `create`（新建节点）/ `update`（更新）/ `complete`（标记完成）/ `append-note`（追加备注）
- 一次最多 20 条候选；`confirmationToken` 一次性且只对应该预览
- 令牌失效或版本冲突 → 回到 preview 重来

### 3.3 只读分析

`search_nodes` 支持组合过滤（tagIds / marks / statuses / priorities / provenanceRoles），适合做「找出所有进行中任务」「汇总风险标记节点」这类盘点，结果直接呈现，不需要写权限。

## 4. 行为准则

1. **写前先问**：任何 dryRun=false / apply 操作前，把预览摘要给用户确认
2. **版本即契约**：写入必须带最新 baseVersion；冲突就读新版重试
3. **最小写入**：优先追加（append），不要试图整图重写；删改现有节点不在 MCP 能力内，需要时提示用户在界面操作
4. **读不到 = 没同步**：MCP 只能看到用户 push 到服务端的导图；列表为空或内容陈旧时，提醒用户在 MindTree 里执行「上传」
5. **幂等意识**：同一批沉淀不要重复 preview/apply；用 `list_deposit_batches` 查待处理批次
6. **附件字节**：文档快照只含附件元数据；图片字节用 `mindtree_attach_image` 写入、REST `GET /api/v1/documents/:doc/attachments/:id` 下载，单文件 ≤ 15MB，仅限 image/png / jpeg / webp / gif

## 5. 示例对话脚本

```text
用户：把这份会议记录整理进「产品规划」导图
agent:
  1. list_documents → 找到「产品规划」(id, version=12)
  2. get_document → 找到目标父节点「Q3 迭代」
  3. 整理成分组层级树（背景/决议/行动项 三层结构）
  4. append_branch dryRun → 给用户看预览
  5. 用户确认 → append_branch baseVersion=12 → 返回插入节点 id
  6. 告知：「已插入 14 个节点，3 层结构；在 MindTree 里 ⌘Z 可撤销」
```
