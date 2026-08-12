import { describe, expect, it } from 'vitest'
import { branchNodeCount, parseGeneratedBranch } from '@/ai/generated-branch'

describe('AI generated branch parser', () => {
  it('parses a fenced JSON branch and normalizes it for insertion', () => {
    const branch = parseGeneratedBranch('```json\n{"topic":"发布计划","children":[{"topic":"内容"},{"topic":"渠道"}]}\n```')

    expect(branch).toMatchObject({ topic: '发布计划', collapsed: false })
    expect(branchNodeCount(branch)).toBe(3)
  })

  it('rejects incomplete model output before it can enter the document', () => {
    expect(() => parseGeneratedBranch('{"children":[]}')).toThrow('缺少主题')
  })

  it('keeps only valid task metadata from an execution-plan response', () => {
    const branch = parseGeneratedBranch('{"topic":"发布","taskStatus":"todo","priority":1,"dueDate":"2026-08-10","children":[{"topic":"无效元数据","taskStatus":"unknown","priority":9,"dueDate":"明天"}]}')

    expect(branch).toMatchObject({ taskStatus: 'todo', priority: 1, dueDate: '2026-08-10' })
    expect(branch.children[0]).toMatchObject({ taskStatus: 'none', priority: 0, dueDate: null })
  })
})
