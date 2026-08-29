import { mkdtempSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Session } from "../src/session.js";
import { SessionTree } from "../src/session-tree.js";

function tmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-"));
  return join(dir, "session.jsonl");
}

describe("SessionTree", () => {
  it("退化成线性链时，pathTo 返回完整历史", () => {
    const tree = new SessionTree();
    tree.append({ role: "user", content: "hi" });
    tree.append({ role: "assistant", content: "hello", toolCalls: [] });
    const path = tree.pathTo();
    expect(path.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("checkout 后 append 会从历史节点分叉，不影响原分支", () => {
    const tree = new SessionTree();
    const root = tree.append({ role: "user", content: "问题" });
    tree.append({ role: "assistant", content: "回答 A", toolCalls: [] });

    tree.checkout(root.id);
    tree.append({ role: "assistant", content: "回答 B", toolCalls: [] });

    expect(tree.childrenOf(root.id)).toHaveLength(2);
    const path = tree.pathTo();
    expect(path.at(-1)).toMatchObject({ content: "回答 B" });
  });
});

describe("Session 持久化与恢复", () => {
  const files: string[] = [];
  afterEach(() => files.splice(0));

  it("append 后重新 open，能完整恢复历史", () => {
    const path = tmpFile();
    const s1 = Session.open(path);
    s1.append({ role: "user", content: "第一条" });
    s1.append({ role: "assistant", content: "第二条", toolCalls: [] });

    const s2 = Session.open(path);
    expect(s2.size()).toBe(2);
    expect(s2.history().map((m) => m.content)).toEqual(["第一条", "第二条"]);
  });

  it("容忍崩溃残留的半行：丢弃最后一行损坏数据，其余照常恢复", () => {
    const path = tmpFile();
    const s1 = Session.open(path);
    s1.append({ role: "user", content: "完好的一条" });

    appendFileSync(path, '{"v":1,"node":{"id":"broke', "utf8");

    const s2 = Session.open(path);
    expect(s2.size()).toBe(1);
    expect(s2.history()[0]).toMatchObject({ content: "完好的一条" });
  });

  it("persistOnEvent 能把 agent 事件流落盘", () => {
    const path = tmpFile();
    const session = Session.open(path);
    const persist = session.persistOnEvent();

    persist({ type: "agent_start", input: "用户输入" });
    persist({
      type: "assistant",
      turn: 1,
      message: { role: "assistant", content: "助手回复", toolCalls: [] },
    });

    const reopened = Session.open(path);
    expect(reopened.history().map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("JSONL 是 append-only：第二次写不会重写已有行", () => {
    const path = tmpFile();
    const s = Session.open(path);
    s.append({ role: "user", content: "A" });
    const after1 = readFileSync(path, "utf8");
    s.append({ role: "user", content: "B" });
    const after2 = readFileSync(path, "utf8");
    expect(after2.startsWith(after1)).toBe(true);
  });
});
