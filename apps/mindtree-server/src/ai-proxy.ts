import type { Express, Request, Response } from 'express'

const upstreamTimeoutMs = 45_000
const maximumUpstreamBytes = 8 * 1024 * 1024
const maximumKeyLength = 512
const rateLimitWindowMs = 60_000
const rateLimitRequests = 60

type RateBucket = { startedAt: number; count: number }

function endpointFrom(value: unknown, allowedHosts: readonly string[]): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('缺少 AI 服务地址')
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('AI 服务地址无效')
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('AI 服务地址必须使用标准 HTTPS')
  }
  if (!allowedHosts.includes(url.hostname.toLowerCase())) throw new Error('不允许代理到该 AI 服务域名')
  if (!url.pathname.endsWith('/chat/completions') || url.search || url.hash) throw new Error('AI 服务地址必须是 Chat Completions 接口')
  return url.toString()
}

function providerAuthorization(request: Request): string {
  const authorization = request.header('authorization')?.trim() ?? ''
  const key = authorization.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? ''
  if (!key || key.length > maximumKeyLength) throw new Error('缺少或无效的 API Key')
  return `Bearer ${key}`
}

async function readLimitedBody(response: globalThis.Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximumUpstreamBytes) throw new Error('AI 服务响应过大')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total)
}

/** 生产 Web 的受限 AI 转发路由；Key 只在本次请求内存中使用，不落盘、不记录。 */
export function attachAiProxyRoute(app: Express, allowedHosts: readonly string[]): void {
  const buckets = new Map<string, RateBucket>()

  app.post('/api/ai/chat', async (request: Request, response: Response) => {
    response.setHeader('cache-control', 'no-store')
    const now = Date.now()
    const client = request.ip || request.socket.remoteAddress || 'unknown'
    const current = buckets.get(client)
    const bucket = !current || now - current.startedAt >= rateLimitWindowMs ? { startedAt: now, count: 0 } : current
    bucket.count += 1
    buckets.set(client, bucket)
    if (bucket.count > rateLimitRequests) return response.status(429).json({ error: { message: 'AI 请求过于频繁，请稍后再试' } })

    let endpoint: string
    let authorization: string
    let payload: unknown
    try {
      endpoint = endpointFrom(request.body?.endpoint, allowedHosts)
      authorization = providerAuthorization(request)
      payload = request.body?.request
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('AI 请求内容无效')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 请求无效'
      const status = message.includes('API Key') ? 401 : 400
      return response.status(status).json({ error: { message } })
    }

    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(upstreamTimeoutMs),
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify(payload),
      })
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel().catch(() => {})
        return response.status(502).json({ error: { message: 'AI 服务返回了不安全的重定向' } })
      }
      const body = await readLimitedBody(upstream)
      response.status(upstream.status)
      response.type(upstream.headers.get('content-type') ?? 'application/json; charset=utf-8')
      return response.send(body)
    } catch (error) {
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      return response.status(timeout ? 504 : 502).json({ error: { message: timeout ? 'AI 服务响应超时' : '无法连接 AI 服务' } })
    }
  })
}
