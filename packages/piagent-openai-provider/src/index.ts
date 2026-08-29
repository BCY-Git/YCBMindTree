import type {
  AssistantMessage,
  Message,
  Model,
  ModelInput,
  ToolDefinition,
} from "@ts-piagent/agent";

export interface OpenAIProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

type ApiMessage = Record<string, unknown>;

function toApiMessage(message: Message): ApiMessage {
  if (message.role === "user") return { role: "user", content: message.content };
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }
  return {
    role: "assistant",
    content: message.content || null,
    ...(message.toolCalls.length > 0
      ? {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments),
            },
          })),
        }
      : {}),
  };
}

function toApiTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export class OpenAIProvider implements Model {
  readonly #apiKey: string | undefined;
  readonly #baseUrl: string;
  readonly #model: string;

  constructor(options: OpenAIProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.#model = options.model;
  }

  async generate(input: ModelInput): Promise<AssistantMessage> {
    const response = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.#model,
        messages: [
          { role: "system", content: input.systemPrompt },
          ...input.messages.map(toApiMessage),
        ],
        tools: input.tools.map(toApiTool),
        tool_choice: "auto",
        temperature: 0,
      }),
      signal: input.signal,
    });

    if (!response.ok) {
      throw new Error(`Model request failed (${response.status}): ${await response.text()}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("Model response has no assistant message");

    return {
      role: "assistant",
      content: message.content ?? "",
      toolCalls: (message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      })),
    };
  }
}
