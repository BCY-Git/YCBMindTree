import { platformFetch } from '@/platform/tauri'

export type ApiClientConfig = {
  serverUrl: string
  token?: string
}

export type ApiRequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown
  headers?: HeadersInit
  query?: Record<string, string | number | boolean | null | undefined>
}

/** 统一承载 HTTP 状态、服务端错误信息和业务响应，供各 API 模块按需处理。 */
export class ApiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    fallbackMessage: string,
  ) {
    super(messageFromBody(body) ?? fallbackMessage)
    this.name = 'ApiHttpError'
  }
}

/** 将服务根地址标准化为 MindTree REST API 根路径。 */
export function apiBaseUrl(serverUrl: string): string {
  const base = serverUrl.trim().replace(/\/+$/, '')
  if (!base) throw new Error('请填写同步服务地址')
  return base.endsWith('/api/v1') ? base : `${base}/api/v1`
}

/**
 * 参照 API 模块封装：统一处理根地址、Bearer Token、JSON 编解码与错误响应。
 * 业务层只调用 get/post/put 等方法，不直接拼 fetch 配置。
 */
export class ApiClient {
  private readonly baseUrl: string

  constructor(private readonly config: ApiClientConfig) {
    this.baseUrl = apiBaseUrl(config.serverUrl)
  }

  get<T>(path: string, query?: ApiRequestOptions['query']): Promise<T> {
    return this.request<T>(path, { method: 'GET', query })
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body })
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body })
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body })
  }

  delete<T>(path: string, query?: ApiRequestOptions['query']): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', query })
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const headers = new Headers(options.headers)
    if (this.config.token?.trim()) headers.set('authorization', `Bearer ${this.config.token.trim()}`)

    let body: BodyInit | undefined
    if (options.body !== undefined) {
      if (options.body instanceof FormData || typeof options.body === 'string' || options.body instanceof Blob || options.body instanceof URLSearchParams) {
        body = options.body
      } else {
        headers.set('content-type', 'application/json')
        body = JSON.stringify(options.body)
      }
    }

    const url = new URL(path.replace(/^\//, ''), `${this.baseUrl}/`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }

    const response = await platformFetch(url, { ...options, headers, body })
    const payload = await parseResponse(response)
    if (!response.ok) throw new ApiHttpError(response.status, payload, `请求失败（HTTP ${response.status}）`)
    return payload as T
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config)
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return response.json().catch(() => null)
  return response.text().catch(() => '')
}

function messageFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const value = body as { error?: { message?: unknown }; message?: unknown }
  if (typeof value.error?.message === 'string') return value.error.message
  return typeof value.message === 'string' ? value.message : null
}
