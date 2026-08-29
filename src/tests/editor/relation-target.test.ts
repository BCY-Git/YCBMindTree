import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '@/domain/document.factory'
import { executeCommand } from '@/domain/commands'
import { planRelationTarget } from '@/editor/relation-target'

function fixture() {
  const base = createInitialDocument()
  const root = base.rootId
  const first = base.nodes[root].childIds[0]
  const second = base.nodes[first].childIds[0]
  return { base, root, first, second }
}

describe('relation target planning', () => {
  it('explains why a node cannot connect to itself', () => {
    const { base, first } = fixture()

    expect(planRelationTarget(base, [first], first)).toEqual({
      status: 'blocked',
      reason: '关系不能连接节点自身',
    })
  })

  it('detects an existing relation in either direction', () => {
    const { base, first, second } = fixture()
    const withRelation = executeCommand(base, { type: 'CREATE_RELATION', sourceId: second, targetId: first }).document

    expect(planRelationTarget(withRelation, [first], second)).toEqual({
      status: 'blocked',
      reason: '节点之间已存在关系',
    })
  })

  it('keeps valid sources in a multi-selection and reports skipped sources', () => {
    const { base, root, first, second } = fixture()
    const withRelation = executeCommand(base, { type: 'CREATE_RELATION', sourceId: root, targetId: second }).document

    expect(planRelationTarget(withRelation, [root, first, second], second)).toEqual({
      status: 'ready',
      sourceIds: [first],
      skippedExisting: 1,
      skippedSelf: 1,
    })
  })

  it('ignores the relation currently being retargeted', () => {
    const { base, root, first } = fixture()
    const withRelation = executeCommand(base, { type: 'CREATE_RELATION', sourceId: root, targetId: first }).document
    const relation = withRelation.relations[0]

    expect(planRelationTarget(withRelation, [root], first, relation.id)).toEqual({
      status: 'ready',
      sourceIds: [root],
      skippedExisting: 0,
      skippedSelf: 0,
    })
  })
})
