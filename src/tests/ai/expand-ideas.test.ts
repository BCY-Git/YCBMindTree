import { describe, expect, it } from 'vitest'
import { parseExpandedIdeas } from '@/ai/expand-ideas'

describe('AI idea expansion', () => {
  it('accepts a fenced JSON response and returns exactly three concise ideas', () => {
    expect(parseExpandedIdeas('```json\n{"ideas":["1. 切入点","关键风险","下一步","额外内容"]}\n```'))
      .toEqual(['切入点', '关键风险', '下一步'])
  })

  it('rejects fewer than three unique ideas', () => {
    expect(() => parseExpandedIdeas('{"ideas":["同一个","同一个"]}')).toThrow('3 个有效想法')
  })
})
