/** Tauri 桌面壳的最小运行时适配层；浏览器仍使用原有 Web API。 */
export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
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
