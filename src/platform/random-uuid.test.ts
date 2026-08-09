import { describe, expect, it, vi } from 'vitest'
import { randomUuid } from './random-uuid'

describe('randomUuid', () => {
  it('uses the browser implementation when it is available', () => {
    const native = vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4123-8123-123456789abc')

    expect(randomUuid()).toBe('12345678-1234-4123-8123-123456789abc')
    expect(native).toHaveBeenCalledOnce()
  })

  it('falls back to getRandomValues outside a secure context', () => {
    const native = crypto.randomUUID
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array
      bytes.set(Array.from({ length: 16 }, (_, index) => index))
      return array
    })

    try {
      expect(randomUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
      expect(random).toHaveBeenCalledOnce()
    } finally {
      random.mockRestore()
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: native })
    }
  })
})
