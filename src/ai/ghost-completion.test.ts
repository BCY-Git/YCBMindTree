import { describe, expect, it } from 'vitest'
import { completionUrl } from './ai-settings'
import { buildGhostCompletionRequest, normalizeCompletion } from './ghost-completion'
import { createInitialDocument } from '../domain/document.factory'

describe('ghost completion helpers', () => {
  it('routes the official DeepSeek endpoint through the beta prefix-completion API', () => {
    expect(completionUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/beta/chat/completions')
  })

  it('removes repeated text from a completion', () => {
    expect(normalizeCompletion('项目目标是', '项目目标是提升团队效率。')).toBe('提升团队效率。')
  })

  it('uses a normal chat completion request instead of DeepSeek prefix mode', () => {
    const document = createInitialDocument()
    const request = buildGhostCompletionRequest({ endpoint: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: '' }, document, document.rootId, '今天天气不错')

    expect(request.request.messages.some((message) => 'prefix' in message)).toBe(false)
  })
})
