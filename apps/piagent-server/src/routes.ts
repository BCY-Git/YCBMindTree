import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { API_ROUTES } from "@ts-piagent/protocol";
import { SessionsService } from "./sessions/sessions.service.js";

/**
 * Hono 路由：把 SessionsService 暴露成 HTTP + SSE。
 * 路由字符串全部来自 protocol 的 API_ROUTES，前后端共用同一份定义。
 *
 * 对比 NestJS：无装饰器、无 DI 容器、无模块——一个 service 实例 + 几个路由。
 * 对这个规模的后端，这种直白反而更清晰。
 */
export function createApp(): Hono {
  const app = new Hono();
  const sessions = new SessionsService();

  // 统一错误处理：把 SESSION_NOT_FOUND 映射成 404
  app.onError((err, c) => {
    const msg = String(err.message ?? err);
    if (msg.startsWith("SESSION_NOT_FOUND")) {
      return c.json(
        { error: { code: "SESSION_NOT_FOUND", message: msg } },
        404,
      );
    }
    return c.json({ error: { code: "INTERNAL", message: msg } }, 500);
  });

  // 会话列表
  app.get(API_ROUTES.sessions, (c) => c.json(sessions.listSessions()));

  // 新建会话
  app.post(API_ROUTES.sessions, (c) => c.json(sessions.createSession()));

  // 取会话树
  app.get("/api/sessions/:id", (c) =>
    c.json(sessions.getTree(c.req.param("id"))),
  );

  // 发消息（异步触发，返回 runId）
  app.post("/api/sessions/:id/messages", async (c) => {
    const { content } = await c.req.json<{ content: string }>();
    return c.json(sessions.sendMessage(c.req.param("id"), content));
  });

  // 分支跳转
  app.post("/api/sessions/:id/checkout", async (c) => {
    const { nodeId } = await c.req.json<{ nodeId: string }>();
    return c.json(sessions.checkout(c.req.param("id"), nodeId));
  });

  // SSE 事件流
  app.get("/api/sessions/:id/events", (c) => {
    const id = c.req.param("id");
    if (!sessions.has(id)) {
      return c.json(
        { error: { code: "SESSION_NOT_FOUND", message: id } },
        404,
      );
    }
    return streamSSE(c, async (stream) => {
      // 订阅事件，逐条写入 SSE
      const unsubscribe = sessions.subscribe(id, (envelope) => {
        void stream.writeSSE({ data: JSON.stringify(envelope) });
      });
      // 保持连接直到客户端断开
      stream.onAbort(() => unsubscribe());
      // 阻塞住，不让 streamSSE 提前结束
      await new Promise<void>((resolve) => stream.onAbort(resolve));
    });
  });

  return app;
}
