import { describe, expect, it } from 'vitest'
import { completionUrl } from './ai-settings'
import { normalizeCompletion } from './ghost-completion'

describe('ghost completion helpers', () => {
  it('routes the official DeepSeek endpoint through the beta prefix-completion API', () => {
    expect(completionUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/beta/chat/completions')
  })

  it('removes repeated text from a completion', () => {
    expect(normalizeCompletion('项目目标是', '项目目标是提升团队效率。')).toBe('提升团队效率。')
  })
})
