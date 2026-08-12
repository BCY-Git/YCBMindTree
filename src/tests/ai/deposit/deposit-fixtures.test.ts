import { describe, expect, it } from 'vitest'
import { parseDepositAnalysis } from '@/ai/deposit/deposit-parser'

const input = { sourceNodeIds: ['source'], destinationNodeIdsByDocument: { document: ['root', 'target'] } }

function parse(candidates: unknown[]) {
  return parseDepositAnalysis(JSON.stringify({ summary: 'fixture', candidates }), input).candidates
}

function candidate(type: string, title: string, action = 'create') {
  return { type, title, detail: title, sourceNodeIds: ['source'], action, suggestedDocumentId: action === 'keep' ? null : 'document', suggestedParentId: action === 'create' ? 'root' : null, suggestedTargetNodeId: action !== 'create' && action !== 'keep' ? 'target' : null, confidence: 0.9, reason: '固定测试样本' }
}

describe('deposit fixed scenario fixtures', () => {
  it('keeps daily records as mixed results, tasks and problems', () => {
    const result = parse([candidate('task', '下午修改无人项目 bug'), candidate('result', '手动分解和自动分解已完成'), candidate('result', 'AFSIM PPT 已完成并交付'), candidate('problem', '地图瓦片路径仍需修改')])
    expect(result.map((item) => item.type)).toEqual(['task', 'result', 'result', 'problem'])
  })

  it('separates learning conclusions from open validation questions', () => {
    const result = parse([candidate('knowledge', 'Zod 在运行时验证数据是否符合 schema'), candidate('problem', '待验证多余字段的默认处理')])
    expect(result.map((item) => item.type)).toEqual(['knowledge', 'problem'])
  })

  it('captures project progress, feedback and next action', () => {
    const result = parse([candidate('result', 'AFSIM PPT 初版已完成', 'append-note'), candidate('problem', '对比图太小且维度不足'), candidate('task', '重新设计第一页对比图')])
    expect(result.map((item) => item.type)).toEqual(['result', 'problem', 'task'])
  })

  it('allows an unassigned temporary idea to remain at the source', () => {
    const result = parse([candidate('idea', '让 AI 从视频中找关键帧并生成文字说明', 'keep')])
    expect(result[0]).toMatchObject({ type: 'idea', action: 'keep', suggestedDocumentId: null })
  })
})
