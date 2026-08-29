import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AssistantDock, AssistantDockToggleButton } from '../../ai/AssistantDock'

beforeAll(() => {
  if (!window.PointerEvent) Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent })
})

describe('AssistantDockToggleButton', () => {
  it('exposes the AI assistant as an independent top-level panel toggle', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<AssistantDockToggleButton open={false} onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button', { name: '显示 AI 助手' }))
    expect(onToggle).toHaveBeenCalledOnce()

    rerender(<AssistantDockToggleButton open onToggle={onToggle} />)
    expect(screen.getByRole('button', { name: '收起 AI 助手' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps the AI and API configuration entry visible in the mobile topbar', () => {
    render(<AssistantDockToggleButton open={false} onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: '显示 AI 助手' }).classList.contains('topbar-mobile-keep')).toBe(true)
  })

  it('quietly signals a record that is ready for deposit while the panel is closed', () => {
    render(<AssistantDockToggleButton open={false} hasNudge onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: '显示 AI 助手 · 有待整理记录' })).toBeTruthy()
  })
})

describe('AssistantDock resizing', () => {
  it('resizes from its left edge and reports the committed width', () => {
    const onWidthChange = vi.fn()
    const onWidthCommit = vi.fn()
    render(<AssistantDock width={360} onWidthChange={onWidthChange} onWidthCommit={onWidthCommit} onClose={vi.fn()}><p>AI 内容</p></AssistantDock>)

    const separator = screen.getByRole('separator', { name: '调整 AI 助手宽度' })
    fireEvent.pointerDown(separator, { clientX: 600, pointerId: 1 })
    fireEvent.pointerMove(separator, { clientX: 520, pointerId: 1 })
    fireEvent.pointerUp(separator, { clientX: 520, pointerId: 1 })

    expect(onWidthChange).toHaveBeenLastCalledWith(440)
    expect(onWidthCommit).toHaveBeenCalledWith(440)
  })

  it('exposes project-scoped tabs and explicit context controls', () => {
    const onTabChange = vi.fn()
    const onContextScopeChange = vi.fn()
    render(<AssistantDock width={360} onWidthChange={vi.fn()} onWidthCommit={vi.fn()} onClose={vi.fn()} title="MindTree Agent" subtitle="重构项目 · 主导图" activeTab="chat" onTabChange={onTabChange} contextScope="project" onContextScopeChange={onContextScopeChange} hasSelection hasProject pendingCount={3}><p>AI 内容</p></AssistantDock>)

    expect(screen.getByText('重构项目 · 主导图')).toBeTruthy()
    expect(screen.getByRole('button', { name: /待沉淀\s*3/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: '当前项目' }).classList.contains('is-active')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '历史' }))
    expect(onTabChange).toHaveBeenCalledWith('history')
    fireEvent.click(screen.getByRole('button', { name: '知识库' }))
    expect(onContextScopeChange).toHaveBeenCalledWith('workspace')
  })
})
