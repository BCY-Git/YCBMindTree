# Ingest：材料 → 思维树（里程碑 C，尚未实现）

本目录收录「给 Agent 一个网页 URL 或本地文件夹，按用户要求整理成思维树」的**业务协议层**：提示词、输出校验、任务组装与面板 UI。

运行机制（ReAct 循环、工具注册、审批、轨迹）在顶层 `src/agent/`，本目录不重复实现；整体设计见 `docs/ai-harness/agent-harness-plan.md`。

## 规划文件

- `ingest-prompt.ts`：系统提示词与任务模板（含文本降级协议说明）。
- `ingest-schema.ts`：整理输出校验（复用 `../generated-branch` 的节点约束）。
- `ingest-service.ts`：组装本次任务的工具集与初始消息，启动 loop，从轨迹提取候选。
- `IngestPanel.tsx`：右侧 Dock 内 UI——URL/文件夹输入、轨迹展示、候选预览确认。
- `tests/`：配套测试统一收在此子目录（与 `src/agent/tests/` 同一约定，不再与源文件同名混排）。

## 边界

- 候选分支写入仍走既有 `generated-branch` 校验 → 预览 → 确认 → `commands` 链路，本目录不提供任何直写通道。
- 遵守 `src/ai/README.md` 维护规则：提示词、类型、解析、测试同目录。
