export type JsonSchema = Record<string, unknown>;

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface UserMessage {
  role: "user";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls: ToolCall[];
}

export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface Tool<TArgs = unknown> extends ToolDefinition {
  parse: (input: unknown) => TArgs;
  execute: (args: TArgs, signal?: AbortSignal) => unknown | Promise<unknown>;
}

export interface ModelInput {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
}

export interface Model {
  generate: (input: ModelInput) => Promise<AssistantMessage>;
}

export type AgentEvent =
  | { type: "agent_start"; input: string }
  | { type: "turn_start"; turn: number }
  | { type: "assistant"; turn: number; message: AssistantMessage }
  | { type: "tool_start"; call: ToolCall }
  | { type: "tool_end"; call: ToolCall; result: ToolResultMessage }
  | { type: "turn_end"; turn: number; messages: Message[] }
  | { type: "agent_end"; result: AgentResult };

export interface RunAgentOptions {
  model: Model;
  tools: Tool<any>[];
  systemPrompt?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
}

export interface AgentResult {
  output: string;
  messages: Message[];
  turns: number;
}
