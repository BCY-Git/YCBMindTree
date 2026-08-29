import type {
  AgentEvent,
  AgentResult,
  Message,
  RunAgentOptions,
  Tool,
  ToolCall,
  ToolResultMessage,
} from "./types.js";

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  const json = JSON.stringify(value, null, 2);
  return json ?? String(value);
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function executeTool(
  call: ToolCall,
  tools: Map<string, Tool<any>>,
  signal: AbortSignal | undefined,
  emit: (event: AgentEvent) => Promise<void>,
): Promise<ToolResultMessage> {
  await emit({ type: "tool_start", call });
  const tool = tools.get(call.name);
  let result: ToolResultMessage;

  if (!tool) {
    result = {
      role: "tool",
      toolCallId: call.id,
      name: call.name,
      content: `Unknown tool: ${call.name}`,
      isError: true,
    };
  } else {
    try {
      signal?.throwIfAborted();
      const args = tool.parse(call.arguments);
      const value = await tool.execute(args, signal);
      result = {
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: stringify(value),
        isError: false,
      };
    } catch (error) {
      result = {
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: errorText(error),
        isError: true,
      };
    }
  }

  await emit({ type: "tool_end", call, result });
  return result;
}

export async function runAgent(
  input: string,
  options: RunAgentOptions,
): Promise<AgentResult> {
  const {
    model,
    tools,
    signal,
    systemPrompt = "You are a helpful tool-using assistant.",
    maxTurns = 8,
    onEvent,
  } = options;
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const definitions = tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
  const messages: Message[] = [{ role: "user", content: input }];
  const emit = async (event: AgentEvent): Promise<void> => {
    await onEvent?.(event);
  };

  await emit({ type: "agent_start", input });
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    signal?.throwIfAborted();
    await emit({ type: "turn_start", turn });

    const assistant = await model.generate({
      systemPrompt,
      messages,
      tools: definitions,
      signal,
    });
    messages.push(assistant);
    await emit({ type: "assistant", turn, message: assistant });

    if (assistant.toolCalls.length === 0) {
      await emit({ type: "turn_end", turn, messages });
      const result = { output: assistant.content, messages, turns: turn };
      await emit({ type: "agent_end", result });
      return result;
    }

    const results = await Promise.all(
      assistant.toolCalls.map((call) =>
        executeTool(call, toolMap, signal, emit),
      ),
    );
    messages.push(...results);
    await emit({ type: "turn_end", turn, messages });
  }

  throw new Error(`Agent exceeded maxTurns=${maxTurns}`);
}
