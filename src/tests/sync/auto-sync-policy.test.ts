import { describe, expect, it } from 'vitest'
import { decideAutoSync, isLocalDirty } from '@/sync/auto-sync-policy'

const now = Date.now()

describe('auto sync policy', () => {
  it('treats missing metadata as dirty and edits after sync as dirty', () => {
    expect(isLocalDirty(null, now)).toBe(true)
    expect(isLocalDirty({ remoteVersion: 3, syncedAt: now - 60_000 }, now)).toBe(true)
    expect(isLocalDirty({ remoteVersion: 3, syncedAt: now }, now)).toBe(false)
  })

  it('pulls when the remote is newer and local is clean', () => {
    expect(decideAutoSync(5, { remoteVersion: 3, syncedAt: now }, now)).toBe('pull')
  })

  it('stops on conflict when both sides changed', () => {
    expect(decideAutoSync(5, { remoteVersion: 3, syncedAt: now - 60_000 }, now)).toBe('conflict')
    expect(decideAutoSync(5, null, now)).toBe('conflict')
  })

  it('pushes local edits when the remote is not newer', () => {
    expect(decideAutoSync(3, { remoteVersion: 3, syncedAt: now - 60_000 }, now)).toBe('push')
    expect(decideAutoSync(2, { remoteVersion: 3, syncedAt: now - 60_000 }, now)).toBe('push')
  })

  it('pushes a first upload when the remote has no copy', () => {
    expect(decideAutoSync(null, null, now)).toBe('push')
    expect(decideAutoSync(null, { remoteVersion: 0, syncedAt: now }, now)).toBe('none')
  })

  it('does nothing when both sides are in sync', () => {
    expect(decideAutoSync(3, { remoteVersion: 3, syncedAt: now }, now)).toBe('none')
  })
})
