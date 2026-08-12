import { describe, expect, it, vi } from 'vitest'
import { createInitialDocument } from '@/domain/document.factory'
import { createDocumentVersion, duplicateDocumentVersion, restoreDocumentVersion } from '@/history/version-history'

describe('document version history', () => {
  it('stores an isolated copy rather than a mutable document reference', () => {
    const document = createInitialDocument()
    const version = createDocumentVersion(document, 'auto')
    document.title = '已修改'

    expect(version.snapshot.title).toBe('未命名导图')
    expect(version.documentId).toBe(document.id)
  })

  it('restores snapshot content while retaining the active document identity', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const original = createInitialDocument()
    const version = createDocumentVersion(original, 'manual')
    const current = { ...original, title: '当前内容', updatedAt: 900 }

    const restored = restoreDocumentVersion(version, current)

    expect(restored.id).toBe(current.id)
    expect(restored.title).toBe('未命名导图')
    expect(restored.updatedAt).toBe(1_000)
    vi.restoreAllMocks()
  })

  it('creates a separate document when saving a historical copy', () => {
    const version = createDocumentVersion(createInitialDocument(), 'manual')
    const copy = duplicateDocumentVersion(version)

    expect(copy.id).not.toBe(version.documentId)
    expect(copy.title).toContain('历史副本')
  })
})
