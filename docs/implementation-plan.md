# MindTree：实施路线

## Iteration 0：工程与可用闭环（当前）

- 建立 Vite React TypeScript 工程与模块目录。
- 完成文档 Schema、工厂、命令执行器、历史栈与递归布局。
- 构建 React Flow 编辑器、节点编辑和键盘路由。
- 接入 IndexedDB 自动保存。
- 覆盖 Command 和布局的关键单元测试。

**完成定义：** 用户可以创建并编辑一张树，刷新页面后内容保留，基础操作可以撤销重做。

## Iteration 1：结构编辑与文件交换

- 节点缩进/提升、结构拖拽、复制剪切粘贴。
- 原生 JSON 与 Markdown 的导入导出。
- SVG、PNG 导出与数据校验提示。

## Iteration 2：布局自由度与使用体验

- 左树、右树与双向树。
- 人工偏移、布局参数、节点宽度和主题。
- 多文档、最近打开、搜索、当前节点选中提示与快捷键帮助。

## Iteration 3：桌面和可编程能力

- Tauri 文件系统、备份、系统菜单与文件关联。
- 稳定的 Command API 之上实现 AI 操作预览、CLI 和 MCP。

## 工程约定

- 先写 Domain / Layout 测试，再改变相应实现。
- 文档格式变化必须升级 `schemaVersion` 并提供迁移。
- React Flow 仅存在于 `editor/` 及其 adapter 中。
- 每一项持久化变更都必须可由 Command 与 History 回放。
