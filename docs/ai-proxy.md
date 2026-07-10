# AI 代理接口约定

## 开发环境

Vite 在 `/api/ai/chat` 提供本地代理，接收浏览器的同源请求，再转发到用户配置的公开 HTTPS、OpenAI Chat Completions 兼容服务。这样浏览器不会直接触发第三方服务的 CORS 限制。

```http
POST /api/ai/chat
Authorization: Bearer <user-api-key>
Content-Type: application/json

{
  "endpoint": "https://api.deepseek.com/chat/completions",
  "request": { "model": "deepseek-v4-flash", "messages": [] }
}
```

代理会透传上游 JSON 响应及 HTTP 状态。仅允许公开 HTTPS 地址，拒绝 localhost、私网地址与 `.local` 域名，避免本机开发代理被误用为 SSRF 跳板。

## 阿里云部署

正式部署时，在 Nginx 后的应用服务实现同一 `/api/ai/chat` 合约。生产代理应增加用户鉴权、速率限制、允许的模型服务商白名单、审计日志与 Key 加密存储；浏览器不应直接调用第三方模型 API。
