import { describe, expect, it } from "vitest";
import { runAgent } from "../src/index.js";
import type { Model, Tool } from "../src/index.js";

const numberTool: Tool<{ value: number }> = {
  name: "double",
  description: "Double a number",
  parameters: { type: "object" },
  parse(input) {
    const value = (input as { value?: unknown }).value;
    if (typeof value !== "number") throw new Error("value must be a number");
    return { value };
  },
  execute: ({ value }) => value * 2,
};

describe("runAgent", () => {
  it("把工具结果送回模型，直到模型返回最终文本", async () => {
    let calls = 0;
    const model: Model = {
      async generate({ messages }) {
        calls += 1;
        if (calls === 1) {
          return {
            role: "assistant",
            content: "需要计算",
            toolCalls: [{ id: "1", name: "double", arguments: { value: 21 } }],
          };
        }
        const result = messages.at(-1);
        return { role: "assistant", content: `答案是 ${result?.content}`, toolCalls: [] };
      },
    };

    const result = await runAgent("计算 21 的两倍", { model, tools: [numberTool] });

    expect(result.output).toBe("答案是 42");
    expect(result.turns).toBe(2);
    expect(result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
  });

  it("把未知工具转换为错误消息，允许模型自愈", async () => {
    let calls = 0;
    const model: Model = {
      async generate({ messages }) {
        calls += 1;
        if (calls === 1) {
          return {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "bad", name: "missing", arguments: {} }],
          };
        }
        expect(messages.at(-1)).toMatchObject({ role: "tool", isError: true });
        return { role: "assistant", content: "我改用文本回答", toolCalls: [] };
      },
    };

    const result = await runAgent("测试错误恢复", { model, tools: [] });

    expect(result.output).toBe("我改用文本回答");
  });

  it("达到最大轮数后停止失控循环", async () => {
    const model: Model = {
      async generate() {
        return {
          role: "assistant",
          content: "",
          toolCalls: [{ id: crypto.randomUUID(), name: "double", arguments: { value: 1 } }],
        };
      },
    };

    await expect(
      runAgent("持续调用工具", { model, tools: [numberTool], maxTurns: 2 }),
    ).rejects.toThrow("maxTurns=2");
  });
});
