# AI 助手交互调研（2026-09）

> 背景：当前 AI 助手交互不友好，调研竞品交互模式，指导 MindTree AI 交互改造。
> 结论先行：**画布优先、节点锚定、面板兜底**。

## 一、现状诊断

当前交互链路：

```text
顶栏魔棒按钮 → 打开右侧 Dock → 选 Tab（协作/待沉淀/足迹）
→ 选范围（当前节点/导图/项目/知识库）→ 聊天框打字描述
→ 等模型返回 → 面板内树形文字预览 → 点确认插入
```

| 痛点 | 表现 |
|---|---|
| 离开工作现场 | 扩展节点要把视线/鼠标移到右侧面板，还要确认「协作范围」 |
| 没有节点级入口 | 选中节点后无任何直接 AI 操作（无右键项、无悬浮按钮） |
| 打字成本高 | 「扩展这个分支」这类一键任务也要组织自然语言 |
| 功能被 Tab 切碎 | 3 个 Tab + 4 级范围选择器，认知负担重 |
| 预览与画布脱节 | 面板里的文字树预览无法直观判断层级质量 |

## 二、竞品交互模式

### Xmind AI（最直接对手）

- 理念："AI lives directly inside your mind map"，不离开画布
- 节点级入口：工具栏星形按钮 + 右键菜单
- 双模式：`On demand`（给提示词）/ `Auto`（直接生成）
- AI Co-pilot：点中央主题一键生成整图框架
- 全流程：生成 → 扩展 → 研究 → 转任务 → 全图重组 → 导出

### Whimsical（最轻量节点级交互）

- 选中节点 → 浮动工具条 ✨ → 每次点击生成 5 个子节点**直接上图**
- 无对话框无面板；连续点击 = 连续扩展
- 生成物是普通节点，undo 天然兜底

### flowith（AI 输出即节点，激进派）

- 每个 prompt/回复都是画布节点，可分叉、并排比较、连线
- Oracle 模式：Agent 自主规划执行多步任务

### tldraw（工程参考价值最高）

官方三种集成模式（tldraw.dev/docs/ai）：

1. 画布作为输出面（Make Real）：选中区域 → 一键 → 结果直接上图
2. AI 作为工作流节点
3. Agent 直接控制编辑器（Agent Starter Kit：右侧 chat + agent 读写画布）

### 国内产品（TreeMind / GitMind / AmyMind）

- 一句话生成整图、文档/图片转导图、AI 续写选中节点
- TreeMind 分屏导图：左资料右导图，对应 ingest 材料整理场景

### 通用 AI UX 研究结论

- Northbase（12 个企业系统）：83% 把 AI 响应放右侧栏 → 面板位置没问题
- 2026 最高杠杆三模式：ghost-text 补全（已有 ✅）、Cmd+K 内联菜单、选中锚定浮动操作条（最缺）
- 布局原则：节点级任务内联、文档级任务工具栏、AI 为主时才用专门工作区

## 三、改造路线

| 优先级 | 改动 | 对齐 |
|---|---|---|
| P0 | 节点选中浮动 AI 工具条：扩展分支/总结/提问/转任务 | Whimsical、Xmind |
| P0 | AI 生成直接上图 + 一键撤销，面板预览降级为可选 | Whimsical |
| P1 | 右键菜单 + Cmd+K 接入 AI 动作（On-demand/Auto 双模式） | Xmind |
| P1 | 面板减负：Tab 收敛，范围自动推断 | 通用模式 |
| P2 | 面板只做长任务（多轮对话、沉淀审查、足迹） | Northbase |
| P3 | 画布内嵌 AI 输入框，以所处位置为父节点生成 | flowith |

## 参考链接

- Xmind AI：https://xmind.com/user-guide/xmind-ai 、https://mindmappingsoftwareblog.com/xmind-ai-review/
- Whimsical：https://whimsical.com/learn/get-started/ai-mind-maps
- flowith：https://www.eesel.ai/blog/flowith
- tldraw：https://tldraw.dev/docs/ai 、https://tldraw.dev/starter-kits/agent
- AI 布局模式：https://www.northbase.design/patterns/ai-output 、https://blog.logrocket.com/ux-design/ai-ui-placement/
