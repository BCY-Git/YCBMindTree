import { describe, expect, it } from 'vitest'
import { inferWorkflowMode } from './workflow-service'
import { parseWorkflowCheckpoint } from './workflow-schema'

describe('workflow collaboration', () => {
  it('suggests a mode without blocking ambiguous input', () => {
    expect(inferWorkflowMode('比较 Three.js 和 Cesium 怎么选')).toBe('decide')
    expect(inferWorkflowMode('实现这个功能并完成测试')).toBe('deliver')
    expect(inferWorkflowMode('为什么 Zod 在运行时生效')).toBe('explore')
  })

  it('validates structured checkpoint output', () => {
    expect(parseWorkflowCheckpoint('{"confirmed":["采用 Three.js"],"rejected":[],"constraints":["只覆盖南京"],"openQuestions":[],"nextActions":["制作原型"]}')).toMatchObject({ confirmed: ['采用 Three.js'], nextActions: ['制作原型'] })
  })
})
