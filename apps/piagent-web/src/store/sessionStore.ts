import { create } from "zustand";
import type {
  AgentEvent,
  SessionTreeDto,
  ToolCall,
} from "@ts-piagent/protocol";

/**
 * ★ 难点 2：Zustand 单 store（这一版按你的决定不拆 runtime）。
 *
 * 用起来像 Pinia：定义 state + 修改 state 的 action，组件里 useSessionStore() 取用。
 *
 * 核心职责：把 SSE 收到的 AgentEvent 翻译成 UI 能渲染的消息列表。
 * 这就是"事件驱动 store，store 驱动 UI"的单向数据流——和 Agent 内核的
 * 事件驱动一脉相承。
 */

// UI 层的消息模型（比后端 Message 多一些渲染用的字段）
export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  // assistant 消息可能伴随工具调用
  toolCalls?: UiToolCall[];
}

export interface UiToolCall {
  id: string;
  name: string;
  args: unknown;
  status: "running" | "done" | "error";
  result?: string;
}

interface SessionState {
  sessionId: string | null;
  messages: UiMessage[];
  isRunning: boolean;
  currentTool: string | null;
  error: string | null;

  // actions
  setSession: (id: string) => void;
  hydrateTree: (tree: SessionTreeDto) => void;
  setError: (message: string | null) => void;
  reset: () => void;
  applyEvent: (event: AgentEvent) => void;
}

let uid = 0;
const nextId = () => `m${uid++}`;

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  messages: [],
  isRunning: false,
  currentTool: null,
  error: null,

  setSession: (id) =>
    set({
      sessionId: id,
      messages: [],
      isRunning: false,
      currentTool: null,
      error: null,
    }),
  hydrateTree: (tree) =>
    set({
      messages: tree.nodes
        .filter((node) => node.onActivePath && node.role !== "tool")
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((node) => ({
          id: node.id,
          role: node.role === "user" ? "user" : "assistant",
          content: node.content,
        })),
    }),
  setError: (message) => set({ error: message }),
  reset: () =>
    set({ messages: [], isRunning: false, currentTool: null, error: null }),

  /**
   * 事件 → 状态的映射表。这是整个前端最核心的逻辑：
   * 每种 AgentEvent 对应一次 state 更新，React 随之重渲染。
   */
  applyEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "agent_start":
          return {
            isRunning: true,
            error: null,
            messages: [
              ...state.messages,
              { id: nextId(), role: "user", content: event.input },
            ],
          };

        case "assistant": {
          // 追加一条 assistant 消息；带上工具调用（初始为 running）
          const toolCalls: UiToolCall[] = event.message.toolCalls.map(
            (c: ToolCall) => ({
              id: c.id,
              name: c.name,
              args: c.arguments,
              status: "running" as const,
            }),
          );
          return {
            messages: [
              ...state.messages,
              {
                id: nextId(),
                role: "assistant",
                content: event.message.content,
                toolCalls: toolCalls.length ? toolCalls : undefined,
              },
            ],
          };
        }

        case "tool_start":
          return { currentTool: event.call.name };

        case "tool_end": {
          // 找到对应的工具调用，填入结果
          const messages = state.messages.map((m) => {
            if (!m.toolCalls) return m;
            const toolCalls = m.toolCalls.map((tc) =>
              tc.id === event.call.id
                ? {
                    ...tc,
                    status: event.result.isError
                      ? ("error" as const)
                      : ("done" as const),
                    result: event.result.content,
                  }
                : tc,
            );
            return { ...m, toolCalls };
          });
          return { messages, currentTool: null };
        }

        case "agent_end":
          return { isRunning: false, currentTool: null };

        default:
          return {};
      }
    }),
}));
