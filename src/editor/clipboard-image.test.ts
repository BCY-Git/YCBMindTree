import { describe, expect, it } from 'vitest'
import { findClipboardImageFile } from './clipboard-image'

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
})
