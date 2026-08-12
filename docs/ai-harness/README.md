# AI Harness

## 方案

- [材料整理 Agent Harness 方案](./agent-harness-plan.md)：目标、分层、工具、权限、测试和里程碑。
- [手写实施指南](./agent-harness-handwriting-guide.md)：八个核心文件的实现顺序和阶段验收。

## 逐文件课程

1. [`types.ts`](./lessons/01-types.md)：从业务流程推导内部通信协议。
2. [`tools/echo.ts`](./lessons/02-echo-tool.md)：建立第一个确定性工具。
3. [`context.ts`](./lessons/03-context.md)：Observation、Token 和消息窗口预算。
4. [`permissions.ts`](./lessons/04-permissions.md)：工具权限与候选边界。
5. [`tool-registry.ts`](./lessons/05-tool-registry.md)：注册、Schema 转换和统一执行管线。
6. [`model-client.ts`](./lessons/06-model-client.md)：模型协议适配、Function Calling 与文本降级。
7. [`trace.ts`](./lessons/07-trace.md)：把结构化运行事件转换成可审计轨迹。
8. [`loop.ts`](./lessons/08-loop.md)：连接模型、工具、Observation、终止与事件的 Agent 核心循环。

完成八课后，运行 `src/tests/agent` 验收 Harness 内核，再进入材料整理业务层。
