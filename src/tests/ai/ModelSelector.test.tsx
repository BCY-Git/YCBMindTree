import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiAssistant } from '../../ai/AiAssistant'
import { createInitialDocument } from '../../domain/document.factory'
import { loadAiSettings, saveAiSettings } from '../../ai/ai-settings'
import { getModelOptions, loadModelConnections } from '../../ai/model-options'
import { streamAiChatReply } from '../../platform/tauri'

vi.mock('../../platform/tauri', () => ({
  requestAiChat: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '模型回复' } }] }), { status: 200 })),
  streamAiChatReply: vi.fn(async (_endpoint: string, _request: unknown, _key: string, onDelta: (delta: string) => void) => { onDelta('模型回复'); return '模型回复' }),
  platformErrorMessage: (_error: unknown, fallback: string) => fallback,
}))

beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

function renderAssistant() {
  const document = createInitialDocument()
  return render(<AiAssistant document={document} targetNodeId={document.rootId} workspaceDocuments={[document]} onBeforeWorkspaceApply={async () => {}} onWorkspaceDocumentsChanged={vi.fn()} />)
}

function openModels() {
  fireEvent.keyDown(screen.getByRole('button', { name: /选择模型，当前/ }), { key: 'ArrowDown' })
}

describe('助手模型选择', () => {
  it('从输入框切换模型，持久化并在下一次请求中使用', async () => {
    renderAssistant()
    openModels()
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /deepseek-v4-pro/ }))
    expect(loadAiSettings().model).toBe('deepseek-v4-pro')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: '发送给 AI 的消息' }), { target: { value: '你好' } })
    fireEvent.click(screen.getByRole('button', { name: '发送 ↗' }))
    await waitFor(() => expect(streamAiChatReply).toHaveBeenCalled())
    expect(streamAiChatReply).toHaveBeenCalledWith('https://api.deepseek.com/chat/completions', expect.objectContaining({ model: 'deepseek-v4-pro' }), '', expect.any(Function))
    expect(await screen.findByText('模型回复')).toBeTruthy()
  })

  it('切换保存的模型时恢复对应服务的密钥，不混用当前服务密钥', async () => {
    saveAiSettings({ endpoint: 'https://gateway.example/v1', model: 'custom-model', apiKey: 'gateway-key' })
    saveAiSettings({ endpoint: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'deepseek-key' })
    renderAssistant()
    openModels()
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /custom-model/ }))
    expect(loadAiSettings()).toEqual({ endpoint: 'https://gateway.example/v1', model: 'custom-model', apiKey: 'gateway-key' })
    expect(screen.queryByText('gateway-key')).toBeNull()
  })

  it('兼容旧配置，并且不向自定义网关添加未经配置的模型', () => {
    const current = { endpoint: 'https://gateway.example/v1', model: 'private-model', apiKey: 'key' }
    localStorage.setItem('mindtree.ai-settings.v1', JSON.stringify(current))
    expect(getModelOptions(loadAiSettings(), loadModelConnections())).toEqual([current])
    saveAiSettings({ ...current, model: 'another-model', apiKey: 'rotated-key' })
    expect(loadModelConnections()).toEqual([
      { ...current, apiKey: 'rotated-key' },
      { ...current, model: 'another-model', apiKey: 'rotated-key' },
    ])
  })
})
