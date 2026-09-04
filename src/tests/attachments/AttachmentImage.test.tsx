import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { saveNodeAttachment } from '../../persistence/database'
import { AttachmentImage } from '../../attachments/AttachmentImage'

describe('AttachmentImage', () => {
  beforeAll(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mindtree-image') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })
  afterAll(() => {
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL
  })

  it('enters proportional resize mode on click and opens the original on double click', async () => {
    const attachment = await saveNodeAttachment('image-document', 'image-node', new File(['image'], '架构图.png', { type: 'image/png' }))
    render(<AttachmentImage attachment={attachment} variant="node" />)

    const image = await screen.findByRole('button', { name: '调整图片 架构图.png' })
    expect(image.querySelector('img')?.getAttribute('src')).toBe('blob:mindtree-image')
    fireEvent.click(image)
    expect(image.closest('.attachment-image')?.classList.contains('is-resizing')).toBe(true)
    expect(screen.queryByRole('dialog', { name: '图片预览 架构图.png' })).toBeNull()
    fireEvent.doubleClick(image)
    expect(screen.getByRole('dialog', { name: '图片预览 架构图.png' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '图片预览 架构图.png' })).toBeNull())
  })
})
