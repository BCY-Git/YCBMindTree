import { describe, expect, it } from 'vitest'
import { MAX_HTML_ATTACHMENT_SIZE, desktopPreviewUrl, htmlTopicName, isHtmlFile, isHtmlFileName, normalizeHtmlFile, sanitizePreviewId } from '@/attachments/html-attachment'

describe('htmlTopicName', () => {
  it('strips the html extension and keeps the base name', () => {
    expect(htmlTopicName('架构图.html')).toBe('架构图')
    expect(htmlTopicName('Report.HTML')).toBe('Report')
    expect(htmlTopicName('page.htm')).toBe('page')
  })

  it('falls back to a placeholder for extension-only names', () => {
    expect(htmlTopicName('.html')).toBe('网页内容')
    expect(htmlTopicName('  .HTML ')).toBe('网页内容')
  })
})

describe('isHtmlFileName', () => {
  it('matches both html extensions case-insensitively', () => {
    expect(isHtmlFileName('架构图.html')).toBe(true)
    expect(isHtmlFile({ name: 'REPORT.HTML', type: '' })).toBe(true)
    expect(isHtmlFileName('page.htm')).toBe(true)
  })

  it('rejects other files', () => {
    expect(isHtmlFileName('page.html.bak')).toBe(false)
    expect(isHtmlFileName('html')).toBe(false)
    expect(isHtmlFileName('chart.png')).toBe(false)
  })
})

describe('isHtmlFile', () => {
  it('accepts the text/html mime even without the extension', () => {
    expect(isHtmlFile({ name: '下载的页面', type: 'text/html' })).toBe(true)
  })

  it('falls back to the extension when WebKit reports an opaque mime', () => {
    expect(isHtmlFile({ name: '页面.html', type: 'application/octet-stream' })).toBe(true)
    expect(isHtmlFile({ name: '页面.html', type: '' })).toBe(true)
  })

  it('rejects non-html files even with odd names', () => {
    expect(isHtmlFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false)
  })
})

describe('normalizeHtmlFile', () => {
  it('forces the text/html mime for extension matches with a wrong type', () => {
    const source = new File(['<p>hi</p>'], '页面.html', { type: 'application/octet-stream' })
    const normalized = normalizeHtmlFile(source)
    expect(normalized.type).toBe('text/html')
    expect(normalized.name).toBe('页面.html')
    expect(normalized.size).toBe(source.size)
  })

  it('appends the extension when only the mime says html', () => {
    const source = new File(['<p>hi</p>'], '下载的页面', { type: 'text/html' })
    expect(normalizeHtmlFile(source).name).toBe('下载的页面.html')
  })

  it('keeps fully normalized files untouched', () => {
    const source = new File(['<p>hi</p>'], 'ok.html', { type: 'text/html' })
    expect(normalizeHtmlFile(source)).toBe(source)
  })

  it('returns unrelated files unchanged', () => {
    const source = new File(['x'], 'notes.txt', { type: 'text/plain' })
    expect(normalizeHtmlFile(source)).toBe(source)
  })
})

describe('sanitizePreviewId', () => {
  it('accepts uuid-shaped ids', () => {
    expect(sanitizePreviewId('a1B2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7')).toBe('a1B2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7')
  })

  it('rejects path traversal and odd characters', () => {
    expect(sanitizePreviewId('../../etc/passwd')).toBeNull()
    expect(sanitizePreviewId('a/b.html')).toBeNull()
    expect(sanitizePreviewId('a.html')).toBeNull()
    expect(sanitizePreviewId('')).toBeNull()
  })
})

describe('desktopPreviewUrl', () => {
  it('uses the custom scheme on mac-like agents and keeps the id in the path', () => {
    expect(desktopPreviewUrl('abc-def')).toBe('mindtree-preview://localhost/abc-def.html')
  })

  it('returns null for unsafe ids', () => {
    expect(desktopPreviewUrl('../escape')).toBeNull()
  })
})

describe('MAX_HTML_ATTACHMENT_SIZE', () => {
  it('stays aligned with the 15 MB attachment limit', () => {
    expect(MAX_HTML_ATTACHMENT_SIZE).toBe(15 * 1024 * 1024)
  })
})
