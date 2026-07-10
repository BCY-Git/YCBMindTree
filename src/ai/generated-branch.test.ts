import { describe, expect, it } from 'vitest'
import { branchNodeCount, parseGeneratedBranch } from './generated-branch'

describe('AI generated branch parser', () => {
  it('parses a fenced JSON branch and normalizes it for insertion', () => {
    const branch = parseGeneratedBranch('```json\n{"topic":"发布计划","children":[{"topic":"内容"},{"topic":"渠道"}]}\n```')

    expect(branch).toMatchObject({ topic: '发布计划', collapsed: false })
    expect(branchNodeCount(branch)).toBe(3)
  })

  it('rejects incomplete model output before it can enter the document', () => {
    expect(() => parseGeneratedBranch('{"children":[]}')).toThrow('缺少主题')
  })
})
