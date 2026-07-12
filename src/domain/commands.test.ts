import { describe, expect, it } from 'vitest'
import { createNodeClipboard, executeCommand } from './commands'
import { createInitialDocument, createQuickNoteDocument } from './document.factory'
import { assertValidDocument } from './document.validator'

describe('MindTree command executor', () => {
  it('creates a local-only quick-note draft without tutorial branches', () => {
    const document = createQuickNoteDocument()

    expect(document).toMatchObject({ isDraft: true, origin: 'quick-note', categoryId: 'uncategorized' })
    expect(Object.keys(document.nodes)).toEqual([document.rootId])
  })

  it('adds a child and keeps both sides of the parent relationship in sync', () => {
    const document = createInitialDocument()
    const result = executeCommand(document, { type: 'ADD_CHILD', parentId: document.rootId, topic: '新分支' })
    const childId = result.focusNodeId!

    expect(result.document.nodes[childId].parentId).toBe(document.rootId)
    expect(result.document.nodes[document.rootId].childIds).toContain(childId)
    expect(() => assertValidDocument(result.document)).not.toThrow()
  })

  it('automatically clears manual offsets after inserting nodes while retaining one freeform restore snapshot', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    document.nodes[document.rootId].offsetX = 75
    document.nodes[branchId].offsetY = -32

    const firstInsert = executeCommand(document, { type: 'ADD_CHILD', parentId: branchId }).document
    const secondInsert = executeCommand(firstInsert, { type: 'ADD_CHILD', parentId: branchId }).document

    expect(Object.values(firstInsert.nodes).every((node) => node.offsetX === 0 && node.offsetY === 0)).toBe(true)
    expect(firstInsert.layout.freeformOffsets?.[document.rootId]).toEqual({ x: 75, y: 0 })
    expect(secondInsert.layout.freeformOffsets?.[branchId]).toEqual({ x: 0, y: -32 })
  })

  it('creates a free topic independently and attaches it to a branch on demand', () => {
    const document = createInitialDocument()
    const free = executeCommand(document, { type: 'ADD_FREE_TOPIC', x: 420, y: 260, topic: '临时想法' })
    const freeId = free.focusNodeId!
    const parentId = document.nodes[document.rootId].childIds[0]
    const attached = executeCommand(free.document, { type: 'ATTACH_FREE_TOPIC', nodeId: freeId, parentId }).document

    expect(free.document.nodes[freeId]).toMatchObject({ isFreeTopic: true, parentId: null, offsetX: 420, offsetY: 260 })
    expect(attached.nodes[freeId]).toMatchObject({ isFreeTopic: false, parentId })
    expect(attached.nodes[parentId].childIds).toContain(freeId)
    expect(() => assertValidDocument(attached)).not.toThrow()
  })

  it('deletes an entire branch and returns focus to its parent', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const descendantIds = document.nodes[branchId].childIds
    const result = executeCommand(document, { type: 'DELETE_NODE', nodeId: branchId })

    expect(result.focusNodeId).toBe(document.rootId)
    expect(result.document.nodes[branchId]).toBeUndefined()
    descendantIds.forEach((id) => expect(result.document.nodes[id]).toBeUndefined())
  })

  it('protects the root node', () => {
    const document = createInitialDocument()
    expect(() => executeCommand(document, { type: 'DELETE_NODE', nodeId: document.rootId })).toThrow('根节点不能删除')
  })

  it('creates a labelled relation, rejects duplicates, and cleans it up with a deleted branch', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const [, secondChild] = document.nodes[branchId].childIds
    const created = executeCommand(document, { type: 'CREATE_RELATION', sourceId: branchId, targetId: secondChild, label: '依赖' })
    const relationId = created.focusRelationId!

    expect(created.document.relations).toContainEqual(expect.objectContaining({ id: relationId, label: '依赖' }))
    expect(() => executeCommand(created.document, { type: 'CREATE_RELATION', sourceId: secondChild, targetId: branchId })).toThrow('已存在关系')

    const removed = executeCommand(created.document, { type: 'DELETE_NODE', nodeId: branchId }).document
    expect(removed.relations).toEqual([])
    expect(() => assertValidDocument(removed)).not.toThrow()
  })

  it('updates and deletes a relation without changing the tree', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const firstChild = document.nodes[branchId].childIds[0]
    const created = executeCommand(document, { type: 'CREATE_RELATION', sourceId: document.rootId, targetId: firstChild })
    const relationId = created.focusRelationId!
    const renamed = executeCommand(created.document, { type: 'UPDATE_RELATION_LABEL', relationId, label: '说明' }).document
    const deleted = executeCommand(renamed, { type: 'DELETE_RELATION', relationId }).document

    expect(renamed.relations[0].label).toBe('说明')
    expect(deleted.relations).toEqual([])
    expect(deleted.nodes).toEqual(document.nodes)
  })

  it('sets task state and priority without changing the tree structure', () => {
    const document = createInitialDocument()
    const nodeId = document.nodes[document.rootId].childIds[0]
    const todo = executeCommand(document, { type: 'SET_NODE_TASK_STATUS', nodeId, taskStatus: 'todo' }).document
    const prioritised = executeCommand(todo, { type: 'SET_NODE_PRIORITY', nodeId, priority: 1 }).document

    expect(prioritised.nodes[nodeId]).toMatchObject({ taskStatus: 'todo', priority: 1 })
    expect(prioritised.nodes[nodeId].childIds).toEqual(document.nodes[nodeId].childIds)
    expect(() => assertValidDocument(prioritised)).not.toThrow()
  })

  it('sets and validates a task due date without changing the tree structure', () => {
    const document = createInitialDocument()
    const nodeId = document.nodes[document.rootId].childIds[0]
    const dated = executeCommand(document, { type: 'SET_NODE_DUE_DATE', nodeId, dueDate: '2030-02-14' }).document

    expect(dated.nodes[nodeId].dueDate).toBe('2030-02-14')
    expect(() => executeCommand(document, { type: 'SET_NODE_DUE_DATE', nodeId, dueDate: '2030-02-30' })).toThrow('截止日期格式无效')
  })

  it('persists a manual node offset without changing the tree structure', () => {
    const document = createInitialDocument()
    const nodeId = document.nodes[document.rootId].childIds[0]
    const result = executeCommand(document, { type: 'UPDATE_NODE_OFFSET', nodeId, offsetX: 86.4, offsetY: -31.2 })

    expect(result.document.nodes[nodeId]).toMatchObject({ offsetX: 86, offsetY: -31 })
    expect(result.document.nodes[nodeId].parentId).toBe(document.rootId)
  })

  it('translates every node when the root node moves', () => {
    const document = createInitialDocument()
    const childId = document.nodes[document.rootId].childIds[0]
    document.nodes[document.rootId].offsetX = 12
    document.nodes[childId].offsetY = -8

    const result = executeCommand(document, { type: 'TRANSLATE_DOCUMENT', deltaX: 37.6, deltaY: -19.3 })

    expect(result.document.nodes[document.rootId]).toMatchObject({ offsetX: 50, offsetY: -19 })
    expect(result.document.nodes[childId]).toMatchObject({ offsetX: 38, offsetY: -27 })
  })

  it('restores the saved freeform layout after automatic arrangement', () => {
    const document = createInitialDocument()
    const childId = document.nodes[document.rootId].childIds[0]
    document.nodes[document.rootId].offsetX = -42
    document.nodes[childId].offsetY = 63

    const automatic = executeCommand(document, { type: 'AUTO_ARRANGE' }).document
    const restored = executeCommand(automatic, { type: 'RESTORE_FREEFORM_LAYOUT' }).document

    expect(automatic.nodes[document.rootId]).toMatchObject({ offsetX: 0, offsetY: 0 })
    expect(automatic.nodes[childId]).toMatchObject({ offsetX: 0, offsetY: 0 })
    expect(restored.nodes[document.rootId]).toMatchObject({ offsetX: -42, offsetY: 0 })
    expect(restored.nodes[childId]).toMatchObject({ offsetX: 0, offsetY: 63 })
  })

  it('applies a document theme without changing its node tree', () => {
    const document = createInitialDocument()
    const result = executeCommand(document, { type: 'APPLY_THEME', themeId: 'midnight' })

    expect(result.document.theme.id).toBe('midnight')
    expect(result.document.nodes).toEqual(document.nodes)
  })

  it('moves a document into a category without touching its map', () => {
    const document = createInitialDocument()
    const result = executeCommand(document, { type: 'SET_CATEGORY', categoryId: 'work' })

    expect(result.document.categoryId).toBe('work')
    expect(result.document.nodes).toEqual(document.nodes)
  })

  it('promotes a quick-note draft to a saved document atomically', () => {
    const document = createInitialDocument()
    document.isDraft = true
    document.origin = 'quick-note'
    const result = executeCommand(document, { type: 'SAVE_QUICK_NOTE', title: '周会行动项', categoryId: 'work' }).document

    expect(result).toMatchObject({ title: '周会行动项', categoryId: 'work', isDraft: false, origin: 'quick-note' })
    expect(result.nodes).toEqual(document.nodes)
  })

  it('collapses and expands all descendant branches without hiding the target itself', () => {
    const document = createInitialDocument()
    const firstBranchId = document.nodes[document.rootId].childIds[0]
    const collapsed = executeCommand(document, { type: 'COLLAPSE_DESCENDANTS', nodeId: document.rootId }).document
    const expanded = executeCommand(collapsed, { type: 'EXPAND_DESCENDANTS', nodeId: document.rootId }).document

    expect(collapsed.nodes[document.rootId].collapsed).toBe(false)
    expect(collapsed.nodes[firstBranchId].collapsed).toBe(true)
    expect(expanded.nodes[firstBranchId].collapsed).toBe(false)
  })

  it('reveals a searched node by expanding only its ancestors', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const childId = document.nodes[branchId].childIds[0]
    document.nodes[branchId].collapsed = true

    const result = executeCommand(document, { type: 'REVEAL_NODE', nodeId: childId })

    expect(result.focusNodeId).toBe(childId)
    expect(result.document.nodes[branchId].collapsed).toBe(false)
  })

  it('moves a node under a new parent without creating a cycle', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const [firstChild, secondChild] = document.nodes[branchId].childIds
    const result = executeCommand(document, { type: 'MOVE_NODE', nodeId: secondChild, newParentId: firstChild, index: 0 })

    expect(result.document.nodes[secondChild].parentId).toBe(firstChild)
    expect(result.document.nodes[branchId].childIds).not.toContain(secondChild)
    expect(() => executeCommand(result.document, { type: 'MOVE_NODE', nodeId: firstChild, newParentId: secondChild, index: 0 })).toThrow('自身子树')
  })

  it('indents and outdents a node while preserving sibling order', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const [firstChild, secondChild] = document.nodes[branchId].childIds
    const indented = executeCommand(document, { type: 'INDENT_NODE', nodeId: secondChild }).document
    const outdented = executeCommand(indented, { type: 'OUTDENT_NODE', nodeId: secondChild }).document

    expect(indented.nodes[secondChild].parentId).toBe(firstChild)
    expect(outdented.nodes[branchId].childIds).toEqual([firstChild, secondChild])
  })

  it('keeps sibling order correct when moving an item downward within the same parent', () => {
    const document = createInitialDocument()
    const parentId = document.nodes[document.rootId].childIds[0]
    const [first, second] = document.nodes[parentId].childIds
    const moved = executeCommand(document, { type: 'MOVE_NODE', nodeId: first, newParentId: parentId, index: 2 }).document

    expect(moved.nodes[parentId].childIds).toEqual([second, first])
  })

  it('copies and pastes a complete branch with fresh node ids', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const result = executeCommand(document, { type: 'PASTE_SUBTREE', parentId: document.rootId, clipboard: createNodeClipboard(document, branchId) })
    const pastedId = result.focusNodeId!

    expect(pastedId).not.toBe(branchId)
    expect(result.document.nodes[pastedId].topic).toBe(document.nodes[branchId].topic)
    expect(result.document.nodes[pastedId].childIds).toHaveLength(document.nodes[branchId].childIds.length)
    expect(() => assertValidDocument(result.document)).not.toThrow()
  })
})
