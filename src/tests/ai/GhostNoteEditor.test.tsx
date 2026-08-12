import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialDocument } from '../../domain/document.factory'
import { saveAiSettings, saveGhostCompletionEnabled } from '../../ai/ai-settings'
import { requestGhostCompletion } from '../../ai/ghost-completion'
import { GhostNoteEditor } from '../../ai/GhostNoteEditor'

vi.mock('../../ai/ghost-completion', () => ({ requestGhostCompletion: vi.fn() }))

describe('GhostNoteEditor', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.useRealTimers())

  it('uses the native textarea text and caret when there is no AI suggestion', () => {
    const document = createInitialDocument()
    const { container } = render(<GhostNoteEditor value="da你好" document={document} nodeId={document.rootId} onChange={vi.fn()} />)

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('da你好')
    expect(container.querySelector('.ghost-note-editor__mirror')).toBeNull()
  })

  it('clips AI suggestion text to the textarea field instead of the hint area', async () => {
    vi.useFakeTimers()
    saveAiSettings({ endpoint: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'test-key' })
    saveGhostCompletionEnabled(true)
    vi.mocked(requestGhostCompletion).mockResolvedValue('，继续形成阶段结论')
    const document = createInitialDocument()
    const { container } = render(<GhostNoteEditor value="已经完成主要工作" document={document} nodeId={document.rootId} onChange={vi.fn()} />)

    await act(async () => {
      vi.advanceTimersByTime(650)
      await Promise.resolve()
    })

    const textarea = screen.getByRole('textbox')
    const mirror = container.querySelector('.ghost-note-editor__mirror')
    const hint = container.querySelector('.ghost-note-editor__hint')
    expect(mirror).not.toBeNull()
    expect(textarea.parentElement?.classList.contains('ghost-note-editor__field')).toBe(true)
    expect(mirror?.parentElement).toBe(textarea.parentElement)
    expect(hint?.parentElement).not.toBe(textarea.parentElement)
  })

  it('keeps AI suggestion text aligned when the textarea scrolls', async () => {
    vi.useFakeTimers()
    saveAiSettings({ endpoint: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'test-key' })
    saveGhostCompletionEnabled(true)
    vi.mocked(requestGhostCompletion).mockResolvedValue('，继续形成阶段结论')
    const document = createInitialDocument()
    const { container } = render(<GhostNoteEditor value="已有多行备注内容" document={document} nodeId={document.rootId} onChange={vi.fn()} />)

    await act(async () => {
      vi.advanceTimersByTime(650)
      await Promise.resolve()
    })

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    const mirror = container.querySelector('.ghost-note-editor__mirror') as HTMLDivElement
    textarea.scrollTop = 42
    textarea.scrollLeft = 7
    fireEvent.scroll(textarea)

    expect(mirror.scrollTop).toBe(42)
    expect(mirror.scrollLeft).toBe(7)
  })
})
