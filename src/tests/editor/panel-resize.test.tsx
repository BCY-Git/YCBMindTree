import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelResizeHandle, loadPanelWidth } from '../../app/PanelResizeHandle'
import { EditorPreferencesDialog } from '../../editor/EditorPreferencesDialog'
import { defaultEditorPreferences } from '../../editor/editor-preferences'

afterEach(() => localStorage.clear())

describe('侧栏宽度', () => {
  it.each(['left', 'right'] as const)('支持 %s 面板键盘调整、保存和恢复默认', (side) => {
    const onChange = vi.fn()
    render(<PanelResizeHandle side={side} width={280} onChange={onChange} />)
    const handle = screen.getByRole('separator')
    fireEvent.keyDown(handle, { key: side === 'left' ? 'ArrowRight' : 'ArrowLeft' })
    expect(onChange).toHaveBeenCalledWith(300)
    expect(loadPanelWidth(side)).toBe(300)
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(loadPanelWidth(side)).toBe(220)
    fireEvent.doubleClick(handle)
    expect(loadPanelWidth(side)).toBe(side === 'left' ? 256 : 272)
  })

  it('设置中的布局修改只发出对应的导图布局字段', () => {
    const onLayoutChange = vi.fn()
    render(<EditorPreferencesDialog open preferences={defaultEditorPreferences} onChange={vi.fn()} onClose={vi.fn()} layout={{ levelGap: 96, siblingGap: 22, freeformOffsets: null }} onLayoutChange={onLayoutChange} />)
    fireEvent.change(screen.getByRole('slider', { name: /层级间距/ }), { target: { value: '120' } })
    expect(onLayoutChange).toHaveBeenCalledWith({ levelGap: 120 })
    fireEvent.change(screen.getByRole('slider', { name: /同级间距/ }), { target: { value: '32' } })
    expect(onLayoutChange).toHaveBeenCalledWith({ siblingGap: 32 })
  })
})
