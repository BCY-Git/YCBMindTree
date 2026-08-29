import type { AssistantMessage, Model, ModelInput } from "@ts-piagent/agent";

/**
 * 确定性假模型：无 API key 时也能把整条链路跑通，方便前端联调。
 * 与 apps/piagent-demo 的 ScriptedModel 同思路——回一句可预测的话，不调工具。
 */
export class ScriptedModel implements Model {
  async generate(input: ModelInput): Promise<AssistantMessage> {
    const lastUser = [...input.messages]
      .reverse()
      .find((m) => m.role === "user");
    const content =
      lastUser && lastUser.role === "user"
        ? `收到：${lastUser.content}`
        : "你好，我是本地占位模型。";
    return { role: "assistant", content, toolCalls: [] };
  }
}
