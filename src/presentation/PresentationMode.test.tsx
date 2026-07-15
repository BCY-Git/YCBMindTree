import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { PresentationMode } from './PresentationMode'

describe('PresentationMode', () => {
  it('navigates by keyboard, reveals notes on demand and exits with Escape', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    document.nodes[branchId].note = '这里是讲述提示'
    const onClose = vi.fn()
    render(<PresentationMode document={document} startNodeId={document.rootId} onClose={onClose} />)

    expect(screen.getByRole('heading', { name: '我的思维导图' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByRole('heading', { name: '从这里开始' })).toBeTruthy()
    expect(screen.queryByText('这里是讲述提示')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '显示演讲备注' }))
    expect(screen.getByText('这里是讲述提示')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
