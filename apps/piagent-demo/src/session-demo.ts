/**
 * 会话持久化 + 崩溃恢复 + 分支 演示。
 *
 * 运行：pnpm --filter @ts-piagent/demo demo:session
 *
 * 它不消耗 API：用一个确定性的假模型跑通整条链路，重点展示 session 能力。
 */
import { runAgent } from "@ts-piagent/agent";
import type { Model } from "@ts-piagent/agent";
import { Session } from "@ts-piagent/session";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 一个只会回一句话、不调工具的确定性模型。
const echoModel: Model = {
  async generate({ messages }) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return {
      role: "assistant",
      content: `收到：${lastUser?.content ?? ""}`,
      toolCalls: [],
    };
  },
};

const path = join(mkdtempSync(join(tmpdir(), "demo-")), "session.jsonl");
console.log(`会话文件：${path}\n`);

// 第 1 次运行：正常对话，全程落盘。
const first = Session.open(path);
await runAgent("你好，第一轮", {
  model: echoModel,
  tools: [],
  onEvent: first.persistOnEvent(),
});
console.log("第一轮结束，磁盘上已有历史：");
console.log(first.history().map((m) => `  ${m.role}: ${m.content}`).join("\n"));

// 模拟“进程崩溃后重启”：全新 Session 从磁盘恢复。
const recovered = Session.open(path);
console.log(`\n重启后恢复了 ${recovered.size()} 条消息 ✅`);

// 记住当前 HEAD，等下从这里分叉。
const branchPoint = recovered.head;

// 沿主线继续第二轮。
await runAgent("接着聊，第二轮", {
  model: echoModel,
  tools: [],
  onEvent: recovered.persistOnEvent(),
});
console.log("\n主线历史：");
console.log(recovered.history().map((m) => `  ${m.role}: ${m.content}`).join("\n"));

// time-travel：回到第一轮结束处，走另一条分支。
if (branchPoint) recovered.checkout(branchPoint);
await runAgent("换个话题，另一条分支", {
  model: echoModel,
  tools: [],
  onEvent: recovered.persistOnEvent(),
});
console.log("\n分支历史（从第一轮分叉）：");
console.log(recovered.history().map((m) => `  ${m.role}: ${m.content}`).join("\n"));

const branches = recovered.childrenOf(branchPoint);
console.log(`\n分叉点下现在有 ${branches.length} 条分支 🌳`);
