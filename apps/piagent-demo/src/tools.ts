import type { Tool } from "@ts-piagent/agent";

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("arguments must be an object");
  }
  return input as Record<string, unknown>;
}

export const calculateTool: Tool<{
  a: number;
  b: number;
  operator: "add" | "multiply";
}> = {
  name: "calculate",
  description: "Add or multiply two numbers",
  parameters: {
    type: "object",
    properties: {
      a: { type: "number" },
      b: { type: "number" },
      operator: { type: "string", enum: ["add", "multiply"] },
    },
    required: ["a", "b", "operator"],
  },
  parse(input) {
    const value = record(input);
    if (typeof value.a !== "number" || typeof value.b !== "number") {
      throw new Error("a and b must be numbers");
    }
    if (value.operator !== "add" && value.operator !== "multiply") {
      throw new Error("operator must be add or multiply");
    }
    return { a: value.a, b: value.b, operator: value.operator };
  },
  execute: ({ a, b, operator }) => (operator === "add" ? a + b : a * b),
};

export const uppercaseTool: Tool<{ text: string }> = {
  name: "uppercase",
  description: "Convert text to uppercase",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  parse(input) {
    const value = record(input);
    if (typeof value.text !== "string") throw new Error("text must be a string");
    return { text: value.text };
  },
  execute: ({ text }) => text.toUpperCase(),
};
