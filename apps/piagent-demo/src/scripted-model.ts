import type {
  AssistantMessage,
  Message,
  Model,
  ModelInput,
} from "@ts-piagent/agent";

export class ScriptedModel implements Model {
  async generate({ messages }: ModelInput): Promise<AssistantMessage> {
    const toolResults = messages.filter((message) => message.role === "tool");
    if (toolResults.length === 0) {
      return {
        role: "assistant",
        content: "我会并行调用两个工具。",
        toolCalls: [
          {
            id: "call_calculate",
            name: "calculate",
            arguments: { a: 21, b: 2, operator: "multiply" },
          },
          {
            id: "call_uppercase",
            name: "uppercase",
            arguments: { text: "tiny agent" },
          },
        ],
      };
    }

    const values = Object.fromEntries(
      toolResults.map((message: Extract<Message, { role: "tool" }>) => [
        message.name,
        message.content,
      ]),
    );
    return {
      role: "assistant",
      content: `计算结果是 ${values.calculate}，文本结果是 ${values.uppercase}。`,
      toolCalls: [],
    };
  }
}
