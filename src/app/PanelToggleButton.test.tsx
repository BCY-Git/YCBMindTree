import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PanelToggleButton } from './PanelToggleButton'

describe('PanelToggleButton', () => {
  it('exposes the left workspace panel as one persistent top-level toggle', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<PanelToggleButton side="left" collapsed onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button', { name: '显示工作区侧栏' }))
    expect(onToggle).toHaveBeenCalledOnce()

    rerender(<PanelToggleButton side="left" collapsed={false} onToggle={onToggle} />)
    expect(screen.getByRole('button', { name: '收起工作区侧栏' }).getAttribute('aria-pressed')).toBe('true')
  })
})
