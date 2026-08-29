# @ts-piagent/web：前端（React 19 + Vite + shadcn + Zustand）

## 当前进度：第一步（骨架能聊天）

- ✅ 三栏布局（左右栏占位，中间聊天主干）
- ✅ 发消息 → SSE 收流 → 渲染回复的主链路
- ✅ 工具卡片基本形态（第二步打磨）
- ⬜ 会话列表（第二步）
- ⬜ 分支面板 / React Flow（第三步）

## 启动

需要后端先起来：

```bash
# 终端 1：起后端
pnpm --filter @ts-piagent/server dev      # :3001

# 终端 2：起前端
pnpm --filter @ts-piagent/web dev         # :5173
```

打开 http://localhost:5173 。Vite 已把 /api 代理到 :3001，无需处理 CORS。
后端无 .env 配置时用 ScriptedModel，也能看到"收到：xxx"的回复，链路可验证。

## 三个核心难点（review 重点）

| 文件 | 难点 | 讲解位置 |
| --- | --- | --- |
| `src/api/events.ts` | SSE 封装、生命周期、seq 去重 | 文件头注释 |
| `src/store/sessionStore.ts` | Zustand 单 store、事件→状态映射 | applyEvent 注释 |
| `src/features/chat/ChatView.tsx` | 事件驱动渲染、useEffect 管订阅 | 文件头注释 |

## 数据流

```
用户输入 → Composer → POST /messages（只触发）
                              ↓
后端跑 runAgent，onEvent 推 SSE
                              ↓
events.ts 收到 → store.applyEvent → state 变化 → 组件重渲染
```

单向数据流：SSE → store → UI。这和 Agent 内核的事件驱动一脉相承。

## 已知待办（第二步起）

- Composer 发消息前，第一条 user 消息目前依赖后端 agent_start 事件回显，
  可考虑前端乐观更新（先本地显示再等确认）。
- 错误 toast、加载态、断线重连提示。
- 会话列表、分支面板。
