# TS Pi Agent：TypeScript 约 100 行实现通用 Agent Loop

这是一个 `pnpm monorepo`。工程把“约 100 行的通用 Agent Loop”、模型适配器和演示程序分开，便于理解 Agent 的最小闭环，并继续扩展生产级能力。

## 目录结构

```text
.
├── apps/piagent-demo             # 可重复运行的 CLI 演示
├── apps/piagent-server           # Hono + SSE 服务端
├── apps/piagent-web              # Vite Web 客户端
├── packages/piagent-agent        # 约 100 行 Agent Loop 内核
├── packages/piagent-openai-provider # OpenAI 兼容接口的模型适配器
├── packages/piagent-protocol     # Web 与服务端共享协议
└── packages/piagent-session      # 会话封装
```

仓库沿用现有包名：

- `@ts-piagent/agent`
- `@ts-piagent/openai-provider`
- `@ts-piagent/demo`

## 快速开始

```bash
pnpm install
pnpm --filter @ts-piagent/demo dev
pnpm check
```

默认演示使用确定性的 `ScriptedModel`，不会消耗 API。接入真实的 OpenAI 兼容接口：

```bash
cp .env.example .env
# 编辑 .env，填入真实配置
pnpm --filter @ts-piagent/demo dev -- "计算 21 × 2，并把 tiny agent 转成大写"
```

Demo 会依次读取项目根目录和 `apps/piagent-demo` 下的 `.env`。新封装推荐使用 `OPENAI_API_KEY`、`OPENAI_MODEL` 和 `OPENAI_BASE_URL`，同时兼容原有的 `API_KEY`、`MODEL` 和 `BASE_URL`。

## Agent Loop

核心文件是 `packages/piagent-agent/src/run-agent.ts`，它保留了通用 Agent 的最小闭环：

1. 保存消息上下文。
2. 调用模型取得文本或工具意图。
3. 查找、校验并执行工具。
4. 把成功或失败统一写成 `tool` 消息。
5. 把工具结果交还模型继续推理。
6. 用最大轮数、`AbortSignal` 和事件回调控制生命周期。

## 常用命令

```bash
pnpm dev          # 直接运行 TypeScript 演示
pnpm demo         # 构建后运行演示
pnpm test         # 运行测试
pnpm typecheck    # 全 workspace 类型检查
pnpm check:lines  # 检查核心 Loop 是否仍在约 100 行范围
pnpm build        # 构建全部 package/app
pnpm check        # 完整验证
```
