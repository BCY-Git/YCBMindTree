import type { Model, Tool } from "@ts-piagent/agent";
import { OpenAIProvider } from "@ts-piagent/openai-provider";

/**
 * AgentFactory：集中负责"创建模型 + 装配工具"。
 * 纯类，无框架依赖——和 apps/piagent-demo 的 createModel 同一套逻辑。
 */
export class AgentFactory {
  createModel(): Model | null {
    const model = process.env.OPENAI_MODEL ?? process.env.MODEL;
    if (!model) return null;
    const apiKey = process.env.API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("配置了模型但缺少 API key");
    const baseUrl = process.env.OPENAI_BASE_URL 
    return new OpenAIProvider({ model, apiKey, baseUrl });
  }

  /** 第三梯队 tools 会在这里装配 bash/read/write/edit。 */
  createTools(): Tool<any>[] {
    return [];
  }
}
