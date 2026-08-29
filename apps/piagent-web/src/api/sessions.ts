import { http } from "./client.js";
import {
  API_ROUTES,
  type CreateSessionResponse,
  type SendMessageResponse,
  type CheckoutResponse,
  type SessionSummary,
  type SessionTreeDto,
} from "@ts-piagent/protocol";

/**
 * 会话相关 HTTP 调用。路由全部来自 protocol 的 API_ROUTES 常量，
 * 前后端共用同一份路由定义，杜绝手写字符串拼错。
 */
export const sessionApi = {
  list: () => http.get<SessionSummary[]>(API_ROUTES.sessions),

  create: () => http.post<CreateSessionResponse>(API_ROUTES.sessions),

  getTree: (id: string) =>
    http.get<SessionTreeDto>(API_ROUTES.session(id)),

  sendMessage: (id: string, content: string) =>
    http.post<SendMessageResponse>(API_ROUTES.messages(id), { content }),

  checkout: (id: string, nodeId: string) =>
    http.post<CheckoutResponse>(API_ROUTES.checkout(id), { nodeId }),
};
