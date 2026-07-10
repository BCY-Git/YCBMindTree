# MindTree：技术架构

## 技术选择

- Vite + React + TypeScript：应用与开发环境
- `@xyflow/react`：画布平移、缩放、节点与连线渲染
- Zustand：编辑器与文档状态
- Zod：外部及持久化数据的运行时校验
- Dexie：IndexedDB 持久化
- Vitest：Domain 与布局单元测试
- 浏览器 `fetch`：用户配置的 OpenAI Chat Completions 兼容 AI 服务调用

Tauri、CLI、MCP 不属于当前迭代；核心 Domain 不依赖它们，以便之后复用 Command API。

## 分层与依赖方向

```text
UI / React Flow adapter
        ↓
Editor state + keyboard router
        ↓
Command executor + history
        ↓
Domain document model ← Layout engine
        ↓
Persistence (IndexedDB)
```

UI 不得直接修改 `document.nodes`。所有可持久化变更必须通过 Command executor，得到新文档后再写入历史和持久化层。

## 核心模型

```ts
interface MindMapDocument {
  id: string;
  schemaVersion: 1;
  title: string;
  categoryId: string;
  rootId: string;
  nodes: Record<string, MindNode>;
  layout: LayoutConfig;
  createdAt: number;
  updatedAt: number;
}

interface MindNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  topic: string;
  collapsed: boolean;
  offsetX: number;
  offsetY: number;
  createdAt: number;
  updatedAt: number;
}
```

`parentId` 与 `childIds` 双向存储，命令层负责保持一致；React Flow 的 `Node`、`Edge` 都从该模型即时派生。树边根据父子节点的最终相对位置选择左右锚点，因此人工把节点拖过父节点时不会产生回连；未来的“关系线”将作为另一类独立数据与虚线/箭头样式渲染。

文档只保存主题 ID；完整配色定义由独立主题注册表提供。这样主题可随应用升级扩展，且既有文档仍保持轻量。

## 命令边界

当前支持节点增删改、折叠、结构移动/升降级、复制粘贴、主题、手动位置、根节点整图平移、自动排列与自由布局恢复等命令。

所有命令需保证：根节点不能删除；同级节点顺序不变；每个非根节点只有一个父节点；删除操作删除完整子树。之后的 `MOVE_NODE` 必须额外拒绝移动到自身子树内。

## 布局算法

当前使用右向递归树布局：先计算每棵可见子树的占用高度，再按兄弟顺序分配坐标；父节点垂直位于可见子节点区域的中心。

```text
subtreeHeight = max(nodeHeight, sum(childHeights) + siblingGap × (childCount - 1))
finalPosition = autoPosition + manualOffset
```

节点位置由 `autoPosition + manualOffset` 构成；自动排列会清空当前偏移并将其保存为一份自由布局快照，用户可从右键菜单恢复。

画布的选中状态是临时视图状态，不写入文档；仅以节点外侧的单一实线轮廓标识当前节点，不改变其他节点或连线的可见性。分支整体折叠/展开仍通过命令层修改 `collapsed`，因此可撤销并会被本地持久化。

横向关系存放在文档级 `relations` 数组，而非节点的 `childIds` 中，因此不会干扰树布局。关系命令会拒绝自连与双向重复，并在删除分支时清除所有受影响的关系；画布仅渲染两端当前可见的关系线。

## 持久化

Dexie 以 `documents` 表保存完整、经 Zod 解析的文档。Store 对文档变更防抖自动保存；读取失败或无历史文档时生成一个默认导图。

工作区导航通过 Dexie 的时间倒序文档列表展示已有导图；`categoryId` 随文档持久化，分类名称列表则保存在当前浏览器的 `localStorage` 中。旧文档读取时默认归入“未分类”。

AI 服务地址、模型名和 API Key 不进入导图文档或 IndexedDB，而是保存在当前浏览器的独立 `localStorage` 项中。开发环境中，浏览器将请求发送给同源 `/api/ai/chat`，Vite 代理再转发给用户设置的公开 HTTPS 服务，避免浏览器 CORS 限制。只有用户主动提交提示词时才会传输当前导图的最小结构上下文；调用采用 OpenAI Chat Completions 兼容格式。

AI 生成分支不直接写入文档：客户端先解析并限制 JSON 子树（主题非空、最大 6 层/60 节点），展示预览；用户确认后才经既有 `PASTE_SUBTREE` 命令插入，因此自动继承撤销、自动布局与文档校验保障。
