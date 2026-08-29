import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { runAgent } from "@ts-piagent/agent";
import type { AgentEvent, Model } from "@ts-piagent/agent";
import { OpenAIProvider } from "@ts-piagent/openai-provider";
import { ScriptedModel } from "./scripted-model.js";
import { calculateTool, uppercaseTool } from "./tools.js";

dotenv.config({
  path: [
    fileURLToPath(new URL("../../../.env", import.meta.url)),
    fileURLToPath(new URL("../.env", import.meta.url)),
  ],
  quiet: true,
});

const prompt = process.argv.slice(2).join(" ") ||
  "计算 21 × 2，并把 tiny agent 转成大写。";

function createModel(): Model {
  const model = process.env.OPENAI_MODEL || process.env.MODEL;
  if (!model) return new ScriptedModel();
  const apiKey = process.env.OPENAI_API_KEY || process.env.API_KEY;
  if (!apiKey) throw new Error("API key is required when a model is configured");
  const legacyBaseUrl = process.env.BASE_URL?.replace(/\/$/, "");
  return new OpenAIProvider({
    model,
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL || (legacyBaseUrl
      ? legacyBaseUrl.endsWith("/v1") ? legacyBaseUrl : `${legacyBaseUrl}/v1`
      : undefined),
  });
}

function printEvent(event: AgentEvent): void {
  switch (event.type) {
    case "turn_start":
      console.log(`\n[turn ${event.turn}]`);
      break;
    case "assistant":
      if (event.message.content) console.log(`assistant: ${event.message.content}`);
      break;
    case "tool_start":
      console.log(`tool → ${event.call.name}`, event.call.arguments);
      break;
    case "tool_end":
      console.log(`tool ← ${event.call.name}: ${event.result.content}`);
      break;
  }
}

console.log(
  process.env.OPENAI_MODEL || process.env.MODEL
    ? "使用真实模型适配器"
    : "使用确定性 ScriptedModel",
);
const result = await runAgent(prompt, {
  model: createModel(),
  tools: [calculateTool, uppercaseTool],
  systemPrompt: "你是一个简洁的中文助手。需要时调用工具，并基于工具结果回答。",
  onEvent: printEvent,
});

console.log(`\n最终答案：${result.output}`);
