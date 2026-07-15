import { describe, expect, it } from 'vitest'
import { createInitialDocument, createNode } from '../domain/document.factory'
import { searchWorkspaceNodes } from './workspace-search'

function documentWithNode(title: string, topic: string) {
  const document = createInitialDocument()
  const root = document.nodes[document.rootId]
  const node = createNode(topic, root.id)
  document.title = title
  root.childIds = [node.id]
  document.nodes = { [root.id]: root, [node.id]: node }
  return { document, node }
}

describe('workspace structured search', () => {
  it('searches across documents and ranks an exact topic before a partial topic', () => {
    const exact = documentWithNode('Agent 学习', 'Zod')
    const partial = documentWithNode('项目资料', 'Zod 运行时校验')

    const results = searchWorkspaceNodes({ documents: [partial.document, exact.document], text: 'zod' })

    expect(results.map(({ documentTitle, nodeId, matchedIn }) => ({ documentTitle, nodeId, matchedIn }))).toEqual([
      { documentTitle: 'Agent 学习', nodeId: exact.node.id, matchedIn: ['topic'] },
      { documentTitle: '项目资料', nodeId: partial.node.id, matchedIn: ['topic'] },
    ])
  })

  it('finds text in notes and links without duplicating a node result', () => {
    const fixture = documentWithNode('无人项目', '资料整理')
    fixture.node.note = '验收前确认地图瓦片路径'
    fixture.node.links = [{ id: 'link-1', label: '验收清单', url: 'https://example.com/checklist' }]

    expect(searchWorkspaceNodes({ documents: [fixture.document], text: '验收' })).toMatchObject([
      { nodeId: fixture.node.id, matchedIn: ['note', 'link'] },
    ])
  })

  it('combines semantic filter groups with AND and values inside a group with OR', () => {
    const matching = documentWithNode('无人项目', '地图瓦片路径')
    matching.node.taskStatus = 'todo'
    matching.node.priority = 1
    matching.node.marks = ['risk']
    matching.node.tagIds = ['work']
    const excluded = documentWithNode('历史项目', '旧问题')
    excluded.node.taskStatus = 'done'
    excluded.node.priority = 1
    excluded.node.marks = ['risk']
    excluded.node.tagIds = ['work']

    const results = searchWorkspaceNodes({
      documents: [excluded.document, matching.document],
      text: '',
      filters: { tagIds: ['work'], statuses: ['todo', 'doing'], priorities: [1], marks: ['risk', 'flag'] },
    })

    expect(results.map((result) => result.nodeId)).toEqual([matching.node.id])
  })

  it('matches the names of tags attached to a node', () => {
    const fixture = documentWithNode('产品规划', '第一阶段')
    fixture.node.tagIds = ['mindtree']

    expect(searchWorkspaceNodes({
      documents: [fixture.document],
      tags: [{ id: 'mindtree', name: 'MindTree 产品', color: '#467566' }],
      text: '产品',
    })).toMatchObject([{ nodeId: fixture.node.id, matchedIn: ['tag'] }])
  })

  it('filters nodes by whether they are a confirmed deposit source or target', () => {
    const source = documentWithNode('日报', 'PPT 已交付')
    const target = documentWithNode('AFSIM 项目', '阶段成果')
    const provenance = [{
      id: 'provenance-1', batchId: 'batch-1', candidateId: 'candidate-1', sourceDocumentId: source.document.id,
      sourceNodeIds: [source.node.id], sourceSnapshot: '日报 / PPT 已交付', targetDocumentId: target.document.id,
      targetNodeIds: [target.node.id], action: 'create' as const, model: 'test', acceptedByUser: true, createdAt: 1,
    }]

    expect(searchWorkspaceNodes({
      documents: [source.document, target.document],
      provenance,
      text: '',
      filters: { provenanceRoles: ['target'] },
    })).toMatchObject([{ documentId: target.document.id, nodeId: target.node.id, provenanceRoles: ['target'] }])
  })

  it('excludes temporary drafts unless the caller explicitly includes them', () => {
    const fixture = documentWithNode('随手记', '临时 Agent 想法')
    fixture.document.isDraft = true

    expect(searchWorkspaceNodes({ documents: [fixture.document], text: 'Agent' })).toEqual([])
    expect(searchWorkspaceNodes({ documents: [fixture.document], text: 'Agent', includeDrafts: true })).toHaveLength(1)
  })

  it('returns semantic fields needed by search consumers without rereading the node', () => {
    const fixture = documentWithNode('交付计划', '出差前修改路径')
    Object.assign(fixture.node, { taskStatus: 'doing', priority: 1, dueDate: '2026-07-20', marks: ['risk'], tagIds: ['work'] })

    expect(searchWorkspaceNodes({ documents: [fixture.document], text: '路径' })[0]).toMatchObject({
      taskStatus: 'doing', priority: 1, dueDate: '2026-07-20', marks: ['risk'], tagIds: ['work'],
    })
  })
})
