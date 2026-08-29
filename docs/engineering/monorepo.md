# ESM Monorepo

MindTree 使用 `pnpm workspace` 统一管理全部 JavaScript / TypeScript 包。所有工作区包均声明为 ESM（`"type": "module"`），运行时使用原生 `import` / `export`。

## 布局

```text
.
├── src/                         # @mindtree/web：React、Vite 与 Tauri 桌面端
├── apps/
│   ├── mindtree-server/         # @mindtree/server：Nest 同步、认证与 MCP 服务
│   ├── piagent-demo/            # @ts-piagent/demo：CLI 演示
│   ├── piagent-server/          # @ts-piagent/server：Hono + SSE API
│   └── piagent-web/             # @ts-piagent/web：PiAgent Web 客户端
├── packages/
│   ├── piagent-agent/           # @ts-piagent/agent
│   ├── piagent-openai-provider/ # @ts-piagent/openai-provider
│   ├── piagent-protocol/        # @ts-piagent/protocol
│   └── piagent-session/         # @ts-piagent/session
└── docs/piagent/                # PiAgent 说明与环境变量示例
```

`/Users/martin/Desktop/Ts-PiAgent/Ts-PiAgnet` 的原始工作区未移动；此仓库保留一份不含依赖、构建目录和 `.env` 的源代码副本，方便以同一锁文件共同开发。

## 命令

```bash
pnpm install                 # 只在仓库根目录安装依赖
pnpm dev                     # MindTree Web（默认 5173）
pnpm dev:server              # MindTree Server
pnpm dev:piagent             # PiAgent CLI Demo
pnpm check                   # 全部类型检查、测试与构建
pnpm build:all               # 构建所有 workspace
```

构建输出、`node_modules`、Tauri `target`、测试覆盖率及本地 `.env` 都被 Git 忽略。不要在子目录单独生成 lockfile；根目录的 `pnpm-lock.yaml` 是唯一依赖锁定文件。
