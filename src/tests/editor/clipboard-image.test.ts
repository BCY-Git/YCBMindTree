import { afterEach, describe, expect, it, vi } from 'vitest'
import { findClipboardImageFile, readClipboardHtmlImageFile, readClipboardImageFile } from '@/editor/clipboard-image'

const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn() }))
vi.mock('../../platform/tauri', () => ({ isTauriRuntime: () => native.enabled }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
afterEach(() => { native.enabled = false; native.invoke.mockReset() })

it('reads system images in the desktop WebView without a browser clipboard API', async () => {
  native.enabled = true
  native.invoke.mockResolvedValue(btoa('png-bytes'))
  const file = await readClipboardImageFile(null, null)
  expect(native.invoke).toHaveBeenCalledWith('read_clipboard_image')
  expect(file?.type).toBe('image/png')
  expect(file?.size).toBe(9)
})

it('falls back to browser image data when native reading fails', async () => {
  native.enabled = true
  native.invoke.mockRejectedValue(new Error('unavailable'))
  const file = await readClipboardImageFile(null, { read: async () => [{ types: ['image/png'], getType: async () => new Blob(['png'], { type: 'image/png' }) }] })
  expect(file?.size).toBe(3)
})

describe('findClipboardImageFile', () => {
  it('reads an image copied as a macOS file when clipboard items are empty', () => {
    const image = new File(['png'], 'Finder 截图.png', { type: 'image/png' })

    expect(findClipboardImageFile({ items: [], files: [image] })).toBe(image)
  })

  it('keeps supporting screenshot images exposed as clipboard items', () => {
    const image = new File(['png'], 'image.png', { type: 'image/png' })

    expect(findClipboardImageFile({
      items: [{ type: 'image/png', getAsFile: () => image }],
      files: [],
    })).toBe(image)
  })

  it('restores the image MIME type when WebKit exposes a copied file as binary data', () => {
    const copiedFile = new File(['png'], '架构图.PNG', { type: 'application/octet-stream' })

    const image = findClipboardImageFile({ items: [], files: [copiedFile] })

    expect(image?.name).toBe('架构图.PNG')
    expect(image?.type).toBe('image/png')
  })

  it('falls back to the async clipboard when WebKit exposes an image item without a File', async () => {
    const imageBlob = new Blob(['png'], { type: 'image/png' })
    const reader = {
      read: async () => [{
        types: ['image/png'],
        getType: async (type: string) => {
          expect(type).toBe('image/png')
          return imageBlob
        },
      }],
    }

    const image = await readClipboardImageFile({
      items: [{ type: 'image/png', getAsFile: () => null }],
      files: [],
    }, reader)

    expect(image?.name).toBe('粘贴图片.png')
    expect(image?.type).toBe('image/png')
    expect(image?.size).toBe(imageBlob.size)
  })

  it('stops waiting when the browser clipboard permission request never resolves', async () => {
    const image = await readClipboardImageFile({ items: [], files: [] }, {
      read: () => new Promise(() => {}),
    }, 1)

    expect(image).toBeNull()
  })

  it('reads a data image embedded in copied HTML when no image file is exposed', async () => {
    const image = await readClipboardHtmlImageFile({
      items: [],
      files: [],
      getData: (type) => type === 'text/html' ? '<img src="data:image/png;base64,cG5n">' : '',
    })

    expect(image?.name).toBe('粘贴图片.png')
    expect(image?.type).toBe('image/png')
    expect(image?.size).toBe(3)
  })
})
