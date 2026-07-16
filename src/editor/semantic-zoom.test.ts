import { describe, expect, it } from 'vitest'
import { loadSemanticZoomEnabled, resolveSemanticZoomLevel, saveSemanticZoomEnabled } from './semantic-zoom'

describe('resolveSemanticZoomLevel', () => {
  it('maps the initial viewport to overview, structure, or workspace detail', () => {
    expect(resolveSemanticZoomLevel(null, 0.5, true)).toBe('overview')
    expect(resolveSemanticZoomLevel(null, 0.56, true)).toBe('structure')
    expect(resolveSemanticZoomLevel(null, 0.7, true)).toBe('structure')
    expect(resolveSemanticZoomLevel(null, 0.86, true)).toBe('workspace')
    expect(resolveSemanticZoomLevel(null, 1, true)).toBe('workspace')
  })

  it('keeps the full workspace detail when semantic zoom is disabled', () => {
    expect(resolveSemanticZoomLevel('overview', 0.25, false)).toBe('workspace')
  })

  it('uses separate enter and leave thresholds to avoid flickering near a boundary', () => {
    expect(resolveSemanticZoomLevel('overview', 0.58, true)).toBe('overview')
    expect(resolveSemanticZoomLevel('overview', 0.62, true)).toBe('structure')
    expect(resolveSemanticZoomLevel('structure', 0.58, true)).toBe('structure')
    expect(resolveSemanticZoomLevel('structure', 0.5, true)).toBe('overview')

    expect(resolveSemanticZoomLevel('structure', 0.86, true)).toBe('structure')
    expect(resolveSemanticZoomLevel('structure', 0.91, true)).toBe('workspace')
    expect(resolveSemanticZoomLevel('workspace', 0.86, true)).toBe('workspace')
    expect(resolveSemanticZoomLevel('workspace', 0.81, true)).toBe('structure')
  })
})

describe('semantic zoom preference', () => {
  it('defaults to enabled and persists an explicit user choice', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }

    expect(loadSemanticZoomEnabled(storage)).toBe(true)
    saveSemanticZoomEnabled(false, storage)
    expect(loadSemanticZoomEnabled(storage)).toBe(false)
  })
})
