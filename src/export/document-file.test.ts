import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { createImportedCopy, parseDocumentFile, serializeDocumentFile } from './document-file'

describe('document file export', () => {
  it('wraps a recoverable document without mutating it', () => {
    const document = createInitialDocument()
    const parsed = JSON.parse(serializeDocumentFile(document))

    expect(parsed).toMatchObject({ format: 'mindtree-document', version: 1, document: { id: document.id, title: document.title } })
    expect(parsed.document).toEqual(document)
  })

  it('restores a valid exported document into an independent snapshot', () => {
    const document = createInitialDocument()
    const restored = parseDocumentFile(serializeDocumentFile(document))

    expect(restored).toEqual(document)
    expect(restored).not.toBe(document)
  })

  it('rejects an unsupported or malformed file before it reaches the workspace', () => {
    expect(() => parseDocumentFile('{"format":"other","version":1,"document":{}}')).toThrow('不是受支持的 MindTree 导图文件')
    expect(() => parseDocumentFile('{not json')).toThrow('文件不是有效的 JSON 导图')
  })

  it('creates an import copy with a new document identity without changing its map content', () => {
    const document = createInitialDocument()
    const copy = createImportedCopy(document, 1_700_000_000_000)

    expect(copy).toMatchObject({ title: `${document.title}（导入副本）`, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 })
    expect(copy.id).not.toBe(document.id)
    expect(copy.nodes).toEqual(document.nodes)
  })
})
