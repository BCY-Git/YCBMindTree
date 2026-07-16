import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportFileStatus, saveExportFile } from './export-file'

const native = vi.hoisted(() => ({ enabled: false, save: vi.fn(), writeFile: vi.fn() }))
vi.mock('../platform/tauri', () => ({ isTauriRuntime: () => native.enabled }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: native.save }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: native.writeFile }))

describe('saveExportFile', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    native.enabled = false
    native.save.mockReset()
    native.writeFile.mockReset()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mindtree-export') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  afterEach(() => {
    vi.runAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL
  })

  it('downloads with the suggested filename when no native file picker is available', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const result = await saveExportFile({
      content: '# 导图',
      suggestedName: '项目复盘-outline.md',
      dialogTitle: '导出 Markdown 大纲',
      typeName: 'Markdown',
      extensions: ['md'],
      mimeType: 'text/markdown;charset=utf-8',
    })

    expect(result).toEqual({ method: 'download', fileName: '项目复盘-outline.md' })
    expect(click).toHaveBeenCalledOnce()
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('项目复盘-outline.md')
  })

  it('opens a native save panel and returns the selected desktop path', async () => {
    native.enabled = true
    native.save.mockResolvedValue('/Users/martin/Documents/项目复盘.opml')

    const result = await saveExportFile({
      content: '<opml />',
      suggestedName: '项目复盘.opml',
      dialogTitle: '导出 OPML 大纲',
      typeName: 'OPML',
      extensions: ['opml'],
      mimeType: 'text/x-opml;charset=utf-8',
    })

    expect(native.save).toHaveBeenCalledWith({
      title: '导出 OPML 大纲',
      defaultPath: '项目复盘.opml',
      filters: [{ name: 'OPML', extensions: ['opml'] }],
    })
    expect(native.writeFile).toHaveBeenCalledOnce()
    expect(native.writeFile.mock.calls[0][0]).toBe('/Users/martin/Documents/项目复盘.opml')
    expect(Array.from(native.writeFile.mock.calls[0][1] as Uint8Array)).toEqual(Array.from(new TextEncoder().encode('<opml />')))
    expect(result).toEqual({ method: 'native', fileName: '项目复盘.opml', path: '/Users/martin/Documents/项目复盘.opml' })
  })

  it('treats closing the native save panel as cancellation without writing a file', async () => {
    native.enabled = true
    native.save.mockResolvedValue(null)

    const saving = saveExportFile({
      content: '<svg />',
      suggestedName: '项目复盘.svg',
      dialogTitle: '导出完整导图 SVG',
      typeName: 'SVG',
      extensions: ['svg'],
      mimeType: 'image/svg+xml;charset=utf-8',
    })

    await expect(saving).rejects.toMatchObject({ name: 'AbortError' })
    expect(native.writeFile).not.toHaveBeenCalled()
  })

  it('reports the exact native path and a clear browser download destination', () => {
    expect(exportFileStatus({ method: 'native', fileName: '复盘.svg', path: '/Users/martin/Documents/复盘.svg' }))
      .toBe('已导出到：/Users/martin/Documents/复盘.svg')
    expect(exportFileStatus({ method: 'download', fileName: '复盘.svg' }))
      .toBe('已下载到浏览器默认目录：复盘.svg')
  })
})
