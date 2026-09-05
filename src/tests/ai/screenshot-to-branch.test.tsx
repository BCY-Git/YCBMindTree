import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiAssistant } from '../../ai/AiAssistant'
import { createInitialDocument } from '../../domain/document.factory'
import { saveAiSettings } from '../../ai/ai-settings'
import { useEditorStore } from '../../store/editor.store'
import { requestAiChat } from '../../platform/tauri'
import { readFlowScreenshot, screenshotMaxBytes } from '../../ai/screenshot-to-branch'

vi.mock('../../platform/tauri', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../platform/tauri')>(),
  requestAiChat: vi.fn(),
}))
const flow = { topic: '登录流程', children: [{ topic: '1. 输入账号', children: [] }, { topic: '2. 验证通过？', children: [{ topic: '是：进入首页', children: [] }, { topic: '否：返回登录', children: [] }] }] }
const file = () => new File(['image-data'], '登录流程.png', { type: 'image/png' })

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  saveAiSettings({ endpoint: 'https://api.deepseek.com', model: 'deepseek-v4-flash-vision-exp', apiKey: 'test-key' })
  vi.mocked(requestAiChat).mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(flow) } }] })))
})

function setup() {
  const document = createInitialDocument()
  useEditorStore.getState().hydrate(document)
  render(<AiAssistant document={document} targetNodeId={document.rootId} workspaceDocuments={[document]} onBeforeWorkspaceApply={async () => {}} onWorkspaceDocumentsChanged={vi.fn()} />)
  return document
}

async function upload() {
  fireEvent.change(screen.getByLabelText('上传流程截图'), { target: { files: [file()] } })
  await screen.findByAltText('待转换的流程截图')
}

describe('流程截图转导图', () => {
  it('传递图片内容，确认前不改图，确认后写入所选节点且可以撤销', async () => {
    const original = setup()
    await upload()
    fireEvent.click(screen.getByRole('button', { name: '截图转导图 ↗' }))
    await screen.findByRole('button', { name: '确认插入' })
    expect(requestAiChat).toHaveBeenCalledWith('https://api.deepseek.com/chat/completions', expect.objectContaining({
      model: 'deepseek-v4-flash-vision-exp',
      messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: expect.arrayContaining([
        { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } },
      ]) })]),
    }), 'test-key')
    expect(useEditorStore.getState().document).toEqual(original)
    fireEvent.click(screen.getByRole('button', { name: '确认插入' }))
    const updated = useEditorStore.getState().document
    expect(Object.values(updated.nodes)).toHaveLength(Object.keys(original.nodes).length + 5)
    const root = Object.values(updated.nodes).find((node) => node.topic === '登录流程')
    expect(root?.parentId).toBe(original.rootId)
    act(() => useEditorStore.getState().undo())
    expect(useEditorStore.getState().document).toEqual(original)
  })

  it('纯文本模型阻止发图并保留附件供切换后重试', async () => {
    saveAiSettings({ endpoint: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'test-key' })
    setup()
    await upload()
    fireEvent.click(screen.getByRole('button', { name: '截图转导图 ↗' }))
    await screen.findByText(/当前模型不支持图片/)
    expect(requestAiChat).not.toHaveBeenCalled()
    expect(screen.getByAltText('待转换的流程截图')).toBeTruthy()
  })

  it('支持粘贴、移除，并在接口失败后保留截图', async () => {
    setup()
    fireEvent.paste(screen.getByRole('textbox', { name: '发送给 AI 的消息' }), { clipboardData: { files: [file()] } })
    await screen.findByAltText('待转换的流程截图')
    vi.mocked(requestAiChat).mockRejectedValueOnce(new Error('网络断开'))
    fireEvent.click(screen.getByRole('button', { name: '截图转导图 ↗' }))
    await screen.findByText('网络断开')
    expect(screen.getByAltText('待转换的流程截图')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '移除流程截图' }))
    expect(screen.queryByAltText('待转换的流程截图')).toBeNull()
    expect(screen.getByRole('button', { name: '开始协作 ↗' })).toBeTruthy()
  })

  it('模型返回错误结构时不产生可写入预览', async () => {
    setup()
    vi.mocked(requestAiChat).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"topic":"流程","children":"无效"}' } }] })))
    await upload()
    fireEvent.click(screen.getByRole('button', { name: '截图转导图 ↗' }))
    await waitFor(() => expect(screen.getByText('AI 返回的子节点格式无效')).toBeTruthy())
    expect(screen.queryByRole('button', { name: '确认插入' })).toBeNull()
  })

  it('拒绝非图片和超限文件', async () => {
    await expect(readFlowScreenshot(new File(['svg'], 'test.svg', { type: 'image/svg+xml' }))).rejects.toThrow('PNG')
    await expect(readFlowScreenshot(new File([new Uint8Array(screenshotMaxBytes + 1)], 'large.png', { type: 'image/png' }))).rejects.toThrow('4 MB')
  })
})
