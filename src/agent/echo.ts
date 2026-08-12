import z from "zod";
import type { AgentTool } from "@/agent/types";

export const echoSchema = z.object({
  text: z.string().min(1).max(1000),
});

export const echoTool: AgentTool<z.infer<typeof echoSchema>> = {
  name: "echo",
  description: "回显输入文本。用于验证 Agent 工具调用链路是否正常。",
  category: "read",
  schema: echoSchema,
  async run(args) {
    return { echo: args.text };
  },
};