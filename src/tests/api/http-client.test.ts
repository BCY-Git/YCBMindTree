import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiHttpError, apiBaseUrl, createApiClient } from '@/api/http-client'

afterEach(() => vi.unstubAllGlobals())

describe('MindTree API client', () => {
  it('normalizes the API root and injects the bearer token into JSON requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await createApiClient({ serverUrl: 'https://sync.example.com/', token: 'session-token' }).post<{ ok: boolean }>('/documents', { title: '项目规划' })

    expect(response).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('https://sync.example.com/api/v1/documents')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer session-token')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ title: '项目规划' }))
  })

  it('exposes server error details consistently to API modules', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: '导图不存在' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })))

    await expect(createApiClient({ serverUrl: 'https://sync.example.com' }).get('/documents/missing'))
      .rejects.toMatchObject({ name: 'ApiHttpError', status: 404, message: '导图不存在' } satisfies Partial<ApiHttpError>)
  })

  it('keeps the existing service-root addressing contract', () => {
    expect(apiBaseUrl('https://sync.example.com/api/v1/')).toBe('https://sync.example.com/api/v1')
    expect(() => apiBaseUrl('  ')).toThrow('同步服务地址')
  })
})
