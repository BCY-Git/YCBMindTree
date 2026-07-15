import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { buildPresentationSteps } from './presentation-model'

describe('presentation sequence', () => {
  it('uses visible depth-first order and preserves breadcrumb context', () => {
    const document = createInitialDocument()
    const steps = buildPresentationSteps(document)

    expect(steps.map((step) => step.topic)).toEqual(['我的思维导图', '从这里开始', '按 Tab 创建子节点', '按 Enter 创建同级节点'])
    expect(steps[2].path).toEqual(['我的思维导图', '从这里开始', '按 Tab 创建子节点'])
  })

  it('does not silently present descendants hidden by a collapsed node', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    document.nodes[branchId].collapsed = true

    expect(buildPresentationSteps(document).map((step) => step.nodeId)).toEqual([document.rootId, branchId])
    expect(buildPresentationSteps(document, branchId)).toHaveLength(1)
  })
})
