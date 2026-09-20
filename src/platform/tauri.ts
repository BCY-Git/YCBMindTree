/** Tauri 桌面壳的最小运行时适配层；浏览器仍使用原有 Web API。 */
export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Tauri 插件有时会抛出字符串或序列化对象，保留实际错误便于用户处理配置问题。 */
export function platformErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) return error.message
  return fallback
}

export async function platformFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (isTauriRuntime()) {
    // 原生 HTTP 客户端不受 WebView CORS 限制，但仍只由受控业务代码调用。
    const { fetch } = await import('@tauri-apps/plugin-http')
    return fetch(input.toString(), init)
  }
  return fetch(input, init)
}

function assertPublicHttpsAiEndpoint(value: string) {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  const privateIpv4 = /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  const privateIpv6 = host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')
  if (url.protocol !== 'https:' || host === 'localhost' || host.endsWith('.local') || privateIpv4 || privateIpv6) {
    throw new Error('AI 服务地址必须是公开 HTTPS 地址')
  }
  return url.toString()
}

/**
 * 浏览器开发环境继续经 Vite 代理读取项目 .env；桌面端改为原生 HTTP 请求，
 * 不把开发机密钥打进应用包，仍使用用户在应用内配置的 Key。
 */
export async function requestAiChat(endpoint: string, request: unknown, apiKey: string, signal?: AbortSignal): Promise<Response> {
  const safeEndpoint = assertPublicHttpsAiEndpoint(endpoint)
  if (isTauriRuntime()) {
    if (!apiKey.trim()) throw new Error('桌面版请先在 AI 助手中填写并保存 API Key')
    return platformFetch(safeEndpoint, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify(request),
    })
  }
  return fetch('/api/ai/chat', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
    body: JSON.stringify({ endpoint: safeEndpoint, request }),
  })
}

type ChatResponsePayload = { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }

/**
 * 流式发送 chat 请求：上游支持 SSE 时逐段回调增量，否则静默退回整包解析。
 * Tauri 原生 HTTP 不提供可靠的响应流，桌面端同样退回整包。
 * 仅用于纯对话；结构化生成（分支/计划/沉淀）需要完整 JSON 校验，不走流式。
 */
export async function streamAiChatReply(
  endpoint: string,
  request: Record<string, unknown>,
  apiKey: string,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (isTauriRuntime()) {
    const response = await requestAiChat(endpoint, request, apiKey, signal)
    const payload = await response.json().catch(() => ({})) as ChatResponsePayload
    if (!response.ok) throw new Error(payload.error?.message || `AI 请求失败（${response.status}）`)
    const content = payload.choices?.[0]?.message?.content ?? ''
    if (content) onDelta(content)
    return content
  }
  const safeEndpoint = assertPublicHttpsAiEndpoint(endpoint)
  const response = await fetch('/api/ai/chat', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
    body: JSON.stringify({ endpoint: safeEndpoint, request: { ...request, stream: true } }),
  })
  const contentType = response.headers.get('content-type') ?? ''
  if (response.ok && response.body && contentType.includes('text/event-stream')) {
    const { readSseStream } = await import('./ai-stream')
    return readSseStream(response.body, onDelta)
  }
  const payload = await response.json().catch(() => ({})) as ChatResponsePayload
  if (!response.ok) throw new Error(payload.error?.message || `AI 请求失败（${response.status}）`)
  const content = payload.choices?.[0]?.message?.content ?? ''
  if (content) onDelta(content)
  return content
}
