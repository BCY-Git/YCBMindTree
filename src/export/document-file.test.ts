import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { serializeDocumentFile } from './document-file'

describe('document file export', () => {
  it('wraps a recoverable document without mutating it', () => {
    const document = createInitialDocument()
    const parsed = JSON.parse(serializeDocumentFile(document))

    expect(parsed).toMatchObject({ format: 'mindtree-document', version: 1, document: { id: document.id, title: document.title } })
    expect(parsed.document).toEqual(document)
  })
})
