import { describe, expect, it } from 'vitest'
import { createInitialDocument, createNode } from '../domain/document.factory'
import { retrieveWorkspaceContext } from './workspace-retrieval'

function documentWithNode(title: string, topic: string, note = '') {
  const document = createInitialDocument()
  const root = document.nodes[document.rootId]
  const node = createNode(topic, root.id)
  node.note = note
  document.title = title
  root.childIds = [node.id]
  document.nodes = { [root.id]: root, [node.id]: node }
  return { document, node }
}

describe('AI workspace retrieval', () => {
  it('retrieves related nodes from other maps without including unrelated nodes', () => {
    const current = documentWithNode('当前项目', 'Agent 参数校验')
    const related = documentWithNode('学习记录', 'Zod 核心概念', 'Zod 在运行时校验未知数据。')
    const unrelated = documentWithNode('汇报记录', 'AFSIM PPT 排版')

    const context = retrieveWorkspaceContext({
      documents: [current.document, related.document, unrelated.document],
      currentDocumentId: current.document.id,
      text: 'Zod 应该怎么理解？',
    })

    expect(context).toMatchObject([{ documentId: related.document.id, nodeId: related.node.id, topic: 'Zod 核心概念' }])
    expect(context.some((item) => item.nodeId === unrelated.node.id)).toBe(false)
  })
})
