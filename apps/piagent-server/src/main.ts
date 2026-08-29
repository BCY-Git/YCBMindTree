import { serve } from "@hono/node-server";
import { createApp } from "./routes.js";

const port = Number(process.env.PORT ?? 3001);
const app = createApp();

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Ts-PiAgent server 已启动：http://localhost:${port}`);
});

// 优雅关闭
process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
