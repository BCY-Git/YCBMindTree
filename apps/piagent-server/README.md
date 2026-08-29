# @ts-piagent/server：Hono 后端

把 `packages/*` 纯逻辑包，包装成前端能用的 HTTP + SSE 接口。

## 为什么是 Hono 而不是 NestJS

参照 pi 和 DeepSeek Harness 两个真实 Agent harness 项目——它们都是纯 ESM、
都不用 NestJS，而是用轻量 ESM 原生方案。Agent harness 的后端核心需求是
"轻量、事件流、可组合"，不是 NestJS 擅长的"企业级 DI/装饰器/模块体系"。

Hono 的好处：原生 ESM（无 CJS/ESM 冲突）、无装饰器（无元数据问题，不需要 SWC）、
原生 SSE 支持、和 monorepo 同一套 tsx 工具链。

## 目录

```
src/
├── main.ts                 入口：启动 Hono、优雅关闭
├── routes.ts               HTTP + SSE 路由，对齐 protocol 契约
├── agent/
│   ├── agent.factory.ts    造 model + 装配 tools（纯类）
│   └── scripted-model.ts   无 API key 时的占位模型
└── sessions/
    └── sessions.service.ts 核心：session 持久化 + runAgent + 事件桥（框架无关）
```

## 核心设计：onEvent 一鱼两吃

runAgent 的每个事件同时：(a) 交给 session 落盘，(b) 包上 seq 推给 SSE 订阅者。
一次遍历，持久化与实时推送两个用途。

## 启动

```bash
pnpm install
pnpm --filter @ts-piagent/server dev      # :3001
```

无 .env 时用 ScriptedModel，链路照样通。

## 接口（详见根目录 接口契约.md）

```
GET    /api/sessions             会话列表
POST   /api/sessions             新建会话
GET    /api/sessions/:id         取会话树
POST   /api/sessions/:id/messages   发消息（异步，返回 runId）
POST   /api/sessions/:id/checkout   分支跳转
GET    /api/sessions/:id/events     SSE 事件流
```

## 验证状态

本次已在隔离环境实跑验证：
- ✅ HTTP：POST /api/sessions 返回 {id}
- ✅ 逻辑：创建→列表→发消息→会话树 user→assistant 节点正确
- ✅ SSE 事件流：完整收到 agent_start→turn_start→assistant→turn_end→agent_end
