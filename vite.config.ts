/**
 * Vite + Vitest 配置。
 *
 * 包含两个核心部分：
 * 1. Vitest 测试环境配置（jsdom）
 * 2. 开发服务器代理插件 `mindtree-ai-dev-proxy`：
 *    - 拦截 /api/ai/chat 的 POST 请求
 *    - 验证上游必须是公开 HTTPS 端点（禁止 localhost/private IP / .local 域名）
 *    - 将请求转发给真实 AI 服务（携带用户的 Authorization: Bearer ... 头）
 *
 * 生产部署时需要自行配置反向代理（如 nginx）或使用云函数处理 AI 请求。
 */
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// 禁止代理到本地地址和私有 IP 段，防止 AI Key 被用于攻击内网服务。
const blockedHosts = new Set(['localhost', '0.0.0.0', '::1', 'metadata.google.internal'])

// 解析并验证 endpoint：必须是 https:// 开头，且主机名不是私有地址或 .local 域名。
function assertPublicHttpsEndpoint(value: unknown): string {
  if (typeof value !== 'string') throw new Error('缺少 AI 服务地址')
  const endpoint = value.trim()
  const hostMatch = endpoint.match(/^https:\/\/([^/?#:]+)(?::\d+)?(?:\/|$)/i)
  if (!hostMatch) throw new Error('AI 服务地址必须是公开 HTTPS 地址')
  const hostname = hostMatch[1].toLowerCase()
  const isPrivateIpv4 = /^(127\.|10\.|192\.168\.|169\.254\.)/.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  if (blockedHosts.has(hostname) || hostname.endsWith('.local') || isPrivateIpv4) {
    throw new Error('开发代理仅允许公开 HTTPS AI 服务地址')
  }
  return endpoint
}

// 读取请求 body 的辅助函数；限制最大 1MB，防止内存耗尽。
function readBody(request: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
      if (body.length > 1_000_000) request.destroy(new Error('请求内容过大'))
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

// Vite 开发服务器中间件插件：拦截 AI 代理请求，转发到真实服务。
// 关键安全措施：断言 endpoint 为公开 HTTPS URL，防止密钥被滥用。
const aiDevProxy: Plugin = {
  name: 'mindtree-ai-dev-proxy',
  configureServer(server) {
    server.middlewares.use('/api/ai/chat', async (request: any, response: any, next: any) => {
      if (request.method !== 'POST') return next()
      try {
        const body = JSON.parse(await readBody(request)) as { endpoint?: unknown; request?: unknown }
        const endpoint = assertPublicHttpsEndpoint(body.endpoint)
        const authorization = request.headers.authorization
        if (!authorization?.startsWith('Bearer ')) throw new Error('缺少 API Key')
        if (!body.request || typeof body.request !== 'object') throw new Error('请求内容无效')

        const fetchUpstream = (globalThis as unknown as { fetch: (input: string, init: Record<string, unknown>) => Promise<{ status: number; headers: { get: (name: string) => string | null }; text: () => Promise<string> }> }).fetch
        const upstream = await fetchUpstream(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authorization },
          body: JSON.stringify(body.request),
        })
        response.statusCode = upstream.status
        response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8')
        response.end(await upstream.text())
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI 代理请求失败'
        response.statusCode = 502
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ error: { message } }))
      }
    })
  },
}

export default defineConfig({
  plugins: [react(), aiDevProxy],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
