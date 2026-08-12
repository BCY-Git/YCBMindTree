# 节点语义层：标记、标签、筛选与任务聚合

> 本文档是给实施方（Codex/开发者）的设计与实施依据。先读「现状盘点」和「核心决策」，避免重复造已有功能。

## 1. 背景与现状盘点

MindTree 的节点目前已有以下语义字段（**必须复用，不要重建**）：

| 字段 | 类型 | 含义 | 命令 |
|---|---|---|---|
| `taskStatus` | `'none'\|'todo'\|'doing'\|'done'` | 任务执行状态（`done` 即完成） | `SET_NODE_TASK_STATUS` |
| `priority` | `0\|1\|2\|3` | 优先级（0 未设，1 最高） | `SET_NODE_PRIORITY` |
| `dueDate` | `YYYY-MM-DD \| null` | 截止日期 | `SET_NODE_DUE_DATE` |
| `note` / `links` / `attachments` | … | 备注、链接、附件 | `UPDATE_NODE_NOTE` 等 |

`src/export/markdown.ts` 的 `nodeMarkerPrefix` **已渲染**任务状态（☐/◐/☑）、优先级（`[P1]`）、截止日期、备注、链接、附件，导出模式有 `outline / minutes / ai-context`。

**因此本期真正要新增的是**：
- 非任务的通用**标记 marks**（旗标、星标、风险、灵感）。
- 用户自建的**彩色标签 tags**（最有价值的新能力）。
- 基于标记/标签/任务状态的**筛选与高亮**。
- **任务中心聚合升级**（消费上面已有字段 + 父节点进度 + 定位）。
- 导出**补充 marks/tags**，并新增 `tasks`（checklist）模式。

## 2. 核心决策（先读，避免走弯路）

1. **完成统一到 `taskStatus`**：不引入独立「完成标记」。UI 上的完成勾 = 把 `taskStatus` 切到 `done`/回到 `none`。全应用只有一处完成语义。
2. **优先级不重做**：复用 `priority`，不新增「优先级标记」。
3. **标记 marks 与标签 tags 是两套**：
   - `marks`：少量、固定枚举、内置图标（`flag`/`star`/`risk`/`idea`），无需配置。
   - `tags`：用户自定义，有名称+颜色，**跨文档共享**。
4. **标签库全局共享，存 `localStorage`**（key `mindtree.tags.v1`），与 `categories` 一致；节点只存 `tagIds` 引用。账号体系稳定后再把标签库同步到服务端（本期不做）。
5. **渲染不显著改变节点尺寸**：marks/tags 用节点底部的紧凑图标/色点行，且仅在有内容时占用**固定的一行高度**（见 §4.2）。`tree-layout.ts` 的 `nodeSize` 必须把这一行算进去，否则节点会重叠。
6. **筛选第一版只做「高亮模式」**（改 opacity，不动布局，零抖动）。「仅看结果」模式会触发重新布局导致画布抖动，**列入范围外**。
7. **schema 不升版本**：新增字段在 `document.schema.ts` 用 `.default(...)`，旧文档加载自动补全，保持 `schemaVersion: 1`。
8. **父节点进度先只在任务中心显示**，不强行在节点上画进度环（避免大改节点渲染）。

## 3. 数据模型

### 3.1 `MindNode` 新增字段（`src/domain/document.types.ts`）

```ts
export type NodeMark = 'flag' | 'star' | 'risk' | 'idea'

export type MindNode = {
  // …现有字段…
  marks: NodeMark[]        // 去重；渲染与导出按固定顺序 flag→star→risk→idea
  tagIds: string[]         // 引用全局标签库；悬空 id 渲染时跳过
}
```

### 3.2 全局标签库（新模块 `src/domain/tag-library.ts`）

```ts
export type Tag = { id: string; name: string; color: string }
// localStorage key: mindtree.tags.v1
// API: loadTags()/saveTags(tags)/createTag(name)/renameTag(id,name)/deleteTag(id)
```

`deleteTag` 时**不自动清理节点里的 `tagIds`**（保留悬空引用，避免大范围静默改动）；渲染时找不到定义就跳过。在删除确认弹窗里提示「N 个节点引用了此标签」。

### 3.3 schema（`src/domain/document.schema.ts`）

```ts
marks: z.array(z.enum(['flag','star','risk','idea'])).default([]),
tagIds: z.array(z.string()).default([]),
```

服务端 `server/src/mindmap-document.ts` 的 `nodeSchema` 同步加这两个字段（同样 default），保持前后端校验一致。

## 4. 实施阶段

> 顺序：**阶段 0（数据模型）→ 1（标记）→ 2（标签）→ 3（筛选）→ 4（任务中心）→ 5（导出）**。
> 0+1+2 是数据与交互基础，3/4/5 是消费层。每阶段完成需通过「验收」并跑 `tsc -b && vitest run`（前端）与 `cd server && tsc && vitest run`（服务端）。

### 阶段 0：数据模型与 schema

- `document.types.ts` 加 `NodeMark`、`marks`、`tagIds`。
- `document.schema.ts` + `server/src/mindmap-document.ts` 加字段（default）。
- `document.factory.ts` 的 `createNode` 初始化 `marks: []`、`tagIds: []`。
- **验收**：`tsc` 过；旧文档（无新字段）经 Zod 解析后自动补 `[]`；`assertValidDocument` 不受影响。

### 阶段 1：标记系统 marks

- 命令：`TOGGLE_NODE_MARK { nodeId; mark: NodeMark }`（在 `marks` 中增删，去重，保持固定顺序）。
- 交互：
  - 右键菜单加「标记」子菜单（4 项，已激活的打勾）。
  - 右侧检查器加「标记」行（4 个可点图标）。
- 渲染（`MindNode.tsx`）：节点底部一行紧凑图标，**仅当 `marks` 非空时占一行**（见 §4.2）。
- **不重复实现完成/优先级**：检查器里「完成」勾绑定 `taskStatus`（done↔none），「优先级」绑定现有 `priority`。
- **验收**：标记可加可删、撤销/重做、保存、同步（随文档）、`assertValidDocument` 通过；新增 `commands.test.ts` 用例。

### 阶段 2：自定义标签 tags

- 新模块 `src/domain/tag-library.ts`（load/save/create/rename/delete，localStorage）。
- 命令：`SET_NODE_TAGS { nodeId; tagIds: string[] }`（整体替换；UI 侧维护增删）。
- 交互：
  - 检查器「标签」行：显示当前节点标签色块；输入 `#` 触发「新建/选择」下拉（命中已有标签则复用其 id）。
  - 侧栏新增「标签库」管理入口：改名、改色、删除（删前提示引用数）。
- 渲染：节点底部色点/文字（与 marks 共用那一行）。
- **验收**：标签跨文档复用；改名/改色后所有引用节点同步；删除标签后节点 `tagIds` 保留但渲染跳过；`commands.test.ts` + 新 `tag-library.test.ts` 通过。

### 阶段 3：筛选与高亮（只做高亮模式）

- 状态：在 `editor.store` 或独立 `filter.store` 加 `filter: { tags: string[]; marks: NodeMark[]; statuses: MindNodeTaskStatus[]; priorities: number[] } | null`。
- 顶栏加「筛选」入口（弹出条件面板 + 一键清除）。
- 实现（`MindMapCanvas.tsx`）：
  - `filter === null` 时一切照旧。
  - `filter` 非空时，在 `baseNodes` 的 `useMemo` 里为每个节点算 `matched`；不匹配节点 `style.opacity = 0.18`，匹配保持 1。**不改 `layoutTree`，布局零变化。**
  - 连线：两端都不匹配时一并淡化（edges 的 `style.opacity` 或 `animated:false` + 降透明）。
- **不做**「仅看结果 / 只显示匹配子树」（会重布局抖动，列范围外）。
- **验收**：筛选不改导图数据；切换筛选时画布不抖、视角不动；清除后完全还原；不匹配节点仍可点选/编辑（只是变淡）。

### 阶段 4：任务中心升级

- 现有 `TaskCenter` 升级为聚合视图，**消费 `taskStatus/dueDate/priority/marks/tagIds`**（这些都是前面阶段就绪的数据）：
  - 分组：待办 / 进行中 / 已完成 / 已逾期（`dueDate < 今天` 且 `!== done`）。
  - 筛选：标签、标记、优先级、所属导图。
  - 每行显示：主题、所属节点路径（`根 › … › 当前`）、截止日期、优先级、标签。
  - 点击行 → `REVEAL_NODE`（已有命令）+ `selectNode`，定位到画布。
  - 批量：完成、改优先级、改截止日期。
- **父节点进度**：任务中心列表里，对「其子树含任务」的父节点显示 `done/total`（如 `3/5`）。用一个纯函数 `subtreeTaskProgress(document, nodeId)` 计算，按需调用（不在节点渲染里实时跑，避免性能/布局影响）。
- **验收**：任务中心与节点侧修改双向一致；逾期分组正确；定位能滚到并选中节点；进度数字正确。

### 阶段 5：导出增强

- `markdown.ts`：
  - `nodeMarkerPrefix` / `nodeExtras` 补 marks（符号或文字）与 tags（`#名称`）。
  - 新增 `tasks` 模式（`MarkdownExportMode` 加 `'tasks'`）：只导出 `taskStatus !== 'none'` 的节点，按 `- [ ]`（todo）/ `- [x]`（done）输出 checklist，并带上祖先路径作为上下文。
  - 导出对话框加「任务清单」模式选项 + 预览/复制。
- **验收**：大纲/会议纪要/AI 上下文模式都含 marks/tags；`tasks` 模式产出可用 checklist；`markdown.test.ts` 补用例。

## 5. 关键改动文件清单

| 层 | 文件 | 改动 |
|---|---|---|
| 类型 | `src/domain/document.types.ts` | `NodeMark`、`marks`、`tagIds` |
| 校验 | `src/domain/document.schema.ts`、`server/src/mindmap-document.ts` | 新字段 default |
| 工厂 | `src/domain/document.factory.ts` | 初始化新字段 |
| 命令 | `src/domain/commands.ts` | `TOGGLE_NODE_MARK`、`SET_NODE_TAGS`（+ 测试） |
| 标签库 | `src/domain/tag-library.ts`（新） | 全局标签 CRUD |
| 布局 | `src/layout/tree-layout.ts` | `nodeSize` 计入 marks/tags 行高度 |
| 节点渲染 | `src/editor/MindNode.tsx` | marks 图标 + tags 色点 |
| 画布 | `src/editor/MindMapCanvas.tsx`、`ContextMenu.tsx` | 标记子菜单、筛选高亮 |
| 检查器 | `src/app/App.tsx` | 标记/标签/筛选/任务中心入口 |
| 任务中心 | 现有 TaskCenter 组件 | 聚合视图、进度、定位 |
| 导出 | `src/export/markdown.ts` | marks/tags + tasks 模式 |
| store | `src/store/editor.store.ts`（或新 filter.store） | 筛选状态 |

## 6. 明确不做（本期范围外）

- 「仅看结果」筛选模式（会重布局抖动）。
- 节点上的进度环（进度先只在任务中心）。
- 标签库的云端同步（等账号体系稳定）。
- 标签嵌套/层级、标签合并。
- 新的布局结构（逻辑图/组织结构图/时间线）——属于另一个独立方向，不要混进来。

## 7. 给实施者的提醒

- **先读 §1 现状**，任何「新增优先级/完成/截止」的冲动都先核对是否已有——大概率是复用。
- 每阶段做完立刻 `tsc -b && vitest run`，绿了再下一阶段。
- marks/tags 渲染必须走 §4.2 的「固定一行」约束，并同步改 `nodeSize`，否则布局会重叠。
- 筛选只动 opacity，**绝不**在筛选时调 `layoutTree`。
- 新字段 schema 用 `.default()`，不要升 `schemaVersion`。
