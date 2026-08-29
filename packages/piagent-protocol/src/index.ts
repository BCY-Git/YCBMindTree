/**
 * @ts-piagent/protocol
 *
 * 前后端共享的类型契约。apps/web（React）和 apps/server（Hono）都 import 这里，
 * 保证前端拿到的数据结构和后端返回的永远一致——类型对不齐的 bug 从源头消灭。
 *
 * 设计原则：
 * - 复用内核 @ts-piagent/agent 的 AgentEvent / Message，不重新发明。
 * - 只在"Web 传输"确实需要时才新增 DTO（如给节点加 onActivePath 渲染标记）。
 */
import type { AgentEvent } from "@ts-piagent/agent";

export type { AgentEvent } from "@ts-piagent/agent";
export type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  ToolCall,
} from "@ts-piagent/agent";

// ────────────────────────────────────────────────────────────
// 会话
// ────────────────────────────────────────────────────────────

/** 会话摘要，用于左侧会话列表。 */
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** 会话树中的一个节点（前端渲染用）。 */
export interface SessionNodeDto {
  id: string;
  parentId: string | null;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: number;
  /** 该节点是否落在当前 HEAD 所在的主链上——前端据此高亮当前路径。 */
  onActivePath: boolean;
}

/** 整棵会话树。 */
export interface SessionTreeDto {
  sessionId: string;
  head: string | null;
  nodes: SessionNodeDto[];
}

// ────────────────────────────────────────────────────────────
// 请求 / 响应体
// ────────────────────────────────────────────────────────────

export interface CreateSessionResponse {
  id: string;
}

export interface SendMessageRequest {
  content: string;
}

/** 发消息是异步的：立刻返回 runId，运行过程走 SSE。 */
export interface SendMessageResponse {
  runId: string;
}

export interface CheckoutRequest {
  nodeId: string;
}

export interface CheckoutResponse {
  head: string;
}

// ────────────────────────────────────────────────────────────
// SSE 事件流
// ────────────────────────────────────────────────────────────

/**
 * SSE 推送的信封：内核事件 + 单调序列号。
 * seq 用于前端去重、排序，以及未来断线重连的续传（?afterSeq=N）。
 */
export interface AgentEventEnvelope {
  seq: number;
  event: AgentEvent;
}

// ────────────────────────────────────────────────────────────
// 错误
// ────────────────────────────────────────────────────────────

export type ApiErrorCode =
  | "SESSION_NOT_FOUND"
  | "NODE_NOT_FOUND"
  | "INVALID_INPUT"
  | "INTERNAL";

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

// ────────────────────────────────────────────────────────────
// 路由常量（前后端共用，避免手写字符串拼错）
// ────────────────────────────────────────────────────────────

export const API_ROUTES = {
  sessions: "/api/sessions",
  session: (id: string) => `/api/sessions/${id}`,
  messages: (id: string) => `/api/sessions/${id}/messages`,
  checkout: (id: string) => `/api/sessions/${id}/checkout`,
  events: (id: string) => `/api/sessions/${id}/events`,
} as const;
