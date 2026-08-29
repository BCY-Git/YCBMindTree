# @ts-piagent/session：会话持久化 + 崩溃恢复 + 会话树

在约 100 行的 Agent Loop 之上，增加一层生产级的会话管理能力。**零侵入**——`runAgent` 内核一行未改，全部通过既有的 `onEvent` 钩子挂入。

## 能力

- **JSONL append-only 持久化**：每条消息追加一行，而非全量覆盖。
- **崩溃恢复**：重启后重放日志重建会话；容忍崩溃残留的半行。
- **会话树 / time-travel**：每条消息记录 `parentId`，可从历史任意节点分叉，实现分支与回溯。

## 快速上手

```ts
import { runAgent } from "@ts-piagent/agent";
import { Session } from "@ts-piagent/session";

const session = Session.open("./.sessions/my-session.jsonl");

await runAgent("你好", {
  model,
  tools,
  onEvent: session.persistOnEvent(), // 自动落盘
});

// 进程崩溃后重启：
const recovered = Session.open("./.sessions/my-session.jsonl");
console.log(recovered.history()); // 完整历史已恢复

// time-travel：回到某个历史节点，走另一条分支
recovered.checkout(someNodeId);
```

跑演示（不消耗 API）：

```bash
pnpm --filter @ts-piagent/demo demo:session
```

## 设计取舍（面试可讲）

| 决策 | 为什么 |
| --- | --- |
| JSONL 追加 vs 全量覆盖 | 崩溃安全（最多丢最后一行）；写成本 O(n) 而非 O(n²)；天然是可回放日志 |
| 树 vs 线性数组 | 数组无法表达“从历史某点分叉重来”；树让 time-travel/分支变成 O(1) 语义 |
| 树逻辑与存储分离 | `SessionTree` 可独立单测、可换存储后端；`JsonlStore` 只管落盘 |
| 同步写 | 保证“写完才返回”，避免并发追加交错；对话吞吐足够，无需异步复杂度 |

## 模块

- `session-tree.ts`：纯内存会话树（append / checkout / pathTo / childrenOf）
- `jsonl-store.ts`：JSONL 追加写 + 崩溃恢复读
- `session.ts`：门面，绑定树与存储，提供 `persistOnEvent` 适配器

## 与生产级实现（PI Agent）的差距

本模块覆盖了 session 的核心思想（持久化、崩溃恢复、会话树、分支），约达生产级的核心思想 7 成、工程健壮度 3-4 成。已知待补强项，按性价比排序：

1. **原子发布**：追加写升级为 tmp 文件 + rename 原子替换（更高一档的崩溃安全）。
2. **写操作串行化队列**：用 tail promise 排队，解决跨调用并发写。
3. **完整性校验**：连续 seq 序列号 + id 去重 + parentId 校验，让损坏可检测。
4. **多 lane 并发会话隔离**。
