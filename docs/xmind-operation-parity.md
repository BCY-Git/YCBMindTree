# MindTree × XMind 核心操作对齐清单

更新时间：2026-08-04

## 目标

本轮不追求复制 XMind 的视觉，而是统一“用户做同一件事时”的操作模型：画布、右键菜单、顶部工具栏、命令面板和大纲视图应派发同一条领域命令，并保持一致的焦点、层级、撤销和视角行为。

## 已对齐的核心操作

| 操作域 | MindTree 当前行为 | 入口 |
| --- | --- | --- |
| 新建主题 | 子节点、前/后同级、父节点、空白处自由主题 | `Tab`、`Enter`、`Shift+Enter`、`⌘/Ctrl+Enter`、双击空白、右键、命令面板 |
| 编辑主题 | 双击或 `Space` 继续编辑；选中后直接输入会替换原主题；`Shift+Enter` 换行 | 画布、右键、命令面板、大纲 |
| 删除主题 | 删除完整分支；仅删除当前主题并原位提升其子节点 | `Delete`、`⌘/Ctrl+Backspace`、右键 |
| 复制与移动 | 复制、剪切、粘贴完整分支；复制副本；拖动改变父级、同级顺序、自由/树分支形态 | 系统快捷键、`⌘/Ctrl+D`、右键、拖动 |
| 层级与顺序 | 缩进、减少缩进、同级上/下移动 | `Tab`、`Shift+Tab`、`Option+↑/↓`、拖动 |
| 选择范围 | 单选、修饰键多选、框选、选择分支、选择同级、选择当前画布全部节点 | 点击、框选、右键、`⌘/Ctrl+A` |
| 浏览与聚焦 | 前往中心、仅显示当前分支、折叠当前分支、折叠/展开后代、实际尺寸与缩放 | `⌘/Ctrl+R`、`⌘/Ctrl+;`、`⌘/Ctrl+/`、`⌘/Ctrl+0/+/-`、工具栏、右键 |
| 关系与分组 | 关系线、重定向、名称原位编辑、弧度控制、线型与颜色；边界；摘要 | 顶部工具栏、画布控制点、右侧属性、右键、命令面板、`Shift+⌘/Ctrl+R/B` |
| 信息扩展 | 备注、链接、附件、图片粘贴、任务状态、优先级、标记、标签与筛选高亮 | 右侧属性、节点标记、筛选菜单 |
| 结构化视图 | 导图与大纲共享节点、折叠、层级、任务和标签数据 | 顶部视图切换 |
| 安全与历史 | 结构操作原子撤销；新建后聚焦但不强制移动视角；删除后聚焦最近同级/父级 | `⌘/Ctrl+Z`、版本历史 |

## 本轮统一规则

1. 新建、移动、删除、复制只能通过 `MindMapCommand` 修改文档，UI 不直接改节点结构。
2. 新建主题只打开编辑框，不自动 `fitView`，避免画面抖动。
3. 拖动结构调整后回归自动排列；同级被移走后，剩余节点立即补位。
4. 自由主题不能直接新增子节点，需先附加到主树；完整自由分支可以整体附加或拖入主树。
5. 文字编辑期间禁用节点拖动，鼠标拖选只选择文字；输入法组合态的 `Enter` 不提交节点。
6. 删除完整分支和仅删除当前主题是两种明确操作，避免误删后代。
7. 多入口共享快捷键名称和禁用条件，不能出现“右键能做、命令面板不能做”的分裂状态。

## 尚未完全对齐：需要新增模型或独立设计

以下项目不能只加按钮，需要先扩展文档模型、导出和持久化协议，放入后续阶段：

- 关系标签的独立拖动定位，以及起点端点的双端重定向。
- 边界范围拖拽、样式编辑；摘要作为可继续生长的真实主题分支。
- Callout、编号、图例、贴纸、公式、音频笔记、富文本片段与格式刷。
- 每个分支独立选择布局结构（逻辑图、组织结构图、鱼骨图、时间轴等）。
- 多 Sheet 文档模型，以及 Sheet 间复制、导航与导出。
- 查找并替换、分支独立导出/打印、演示路径编辑。
- 标签自动排序和基于标签/标记组合条件的保存筛选器。

## 后续验收顺序

1. 边界/摘要数据模型升级。
2. 多结构布局和多 Sheet。
3. 富文本、Callout、编号和公式等内容能力。

## 参考

- XMind Topic Editing: https://xmind.com/user-guide/topic-editing-new
- XMind Relationship: https://xmind.com/user-guide/relationship-new
- XMind Boundary: https://xmind.com/user-guide/boundary-new
- XMind Summary: https://xmind.com/user-guide/summary-new
- XMind Branch: https://xmind.com/user-guide/branch-new
- XMind Outliner: https://xmind.com/user-guide/outliner-new
- XMind Find and Replace: https://xmind.com/user-guide/find-and-replace-new
- XMind Topic Filtering: https://xmind.com/user-guide/topic-filtering-new
