import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickAssistant } from '../../ai/QuickAssistant'
import { createInitialDocument } from '../../domain/document.factory'

// loadAiSettings 会把空端点回退为默认值，且测试环境 import.meta.env.DEV 为 true，
// 因此通过 mock 直接控制「已配置 / 未配置」两种状态。
const mocks = vi.hoisted(() => ({ settings: { endpoint: '', model: '', apiKey: '' } }))
vi.mock('../../ai/ai-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ai/ai-settings')>()
  return { ...actual, loadAiSettings: () => mocks.settings }
})

beforeEach(() => {
  localStorage.clear()
  mocks.settings = { endpoint: '', model: '', apiKey: '' }
})

describe('QuickAssistant 模型配置入口', () => {
  it('未配置模型时显示显式的去配置按钮，点击后打开设置并收起面板', () => {
    const onOpenSettings = vi.fn()
    render(<QuickAssistant document={createInitialDocument()} workspaceDocuments={[]} onOpenSettings={onOpenSettings} />)

    fireEvent.click(screen.getByRole('button', { name: '打开随手助手' }))
    const entry = screen.getByRole('button', { name: /去配置模型连接/ })
    fireEvent.click(entry)

    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /去配置模型连接/ })).toBeNull()
  })

  it('已配置模型时不显示去配置按钮', () => {
    mocks.settings = { endpoint: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'sk-test' }
    render(<QuickAssistant document={createInitialDocument()} workspaceDocuments={[]} onOpenSettings={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '打开随手助手' }))
    expect(screen.queryByRole('button', { name: /去配置模型连接/ })).toBeNull()
  })

  it('提问时才发现未配置，也会补出设置入口', () => {
    const onOpenSettings = vi.fn()
    render(<QuickAssistant document={createInitialDocument()} workspaceDocuments={[]} onOpenSettings={onOpenSettings} />)

    fireEvent.click(screen.getByRole('button', { name: '打开随手助手' }))
    // 模拟用户直接点快捷提问：入口仍然保留，且未误触发跳转
    fireEvent.click(screen.getByRole('button', { name: '把当前内容整理成待办清单。' }))
    expect(screen.getByRole('button', { name: /去配置模型连接/ })).toBeTruthy()
    expect(onOpenSettings).not.toHaveBeenCalled()
  })
})
