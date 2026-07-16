import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DraftDocumentItem } from './DraftDocumentItem'

describe('DraftDocumentItem', () => {
  it('offers a dedicated delete action without opening the quick note', () => {
    const onOpen = vi.fn()
    const onDelete = vi.fn()
    render(<DraftDocumentItem title="临时想法" active={false} onOpen={onOpen} onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: '删除随手记“临时想法”' }))

    expect(onDelete).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })
})
