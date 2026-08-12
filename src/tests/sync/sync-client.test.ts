import { describe, expect, it } from 'vitest'
import { apiBaseUrl, defaultSyncServerUrl } from '@/sync/sync-client'

describe('sync API addressing', () => {
  it('ships with the controlled sync server as the default address', () => {
    expect(defaultSyncServerUrl).toBe('http://106.54.44.45:18789')
  })

  it('normalizes a service root into the REST API root', () => {
    expect(apiBaseUrl('https://sync.example.com/')).toBe('https://sync.example.com/api/v1')
    expect(apiBaseUrl('https://sync.example.com/api/v1/')).toBe('https://sync.example.com/api/v1')
  })

  it('requires a configured server URL', () => {
    expect(() => apiBaseUrl('  ')).toThrow('同步服务地址')
  })
})
