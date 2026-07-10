import { describe, expect, it } from 'vitest'
import { createNodeClipboard, executeCommand } from './commands'
import { createInitialDocument } from './document.factory'
import { assertValidDocument } from './document.validator'

describe('MindTree command executor', () => {
  it('adds a child and keeps both sides of the parent relationship in sync', () => {
    const document = createInitialDocument()
    const result = executeCommand(document, { type: 'ADD_CHILD', parentId: document.rootId, topic: '新分支' })
    const childId = result.focusNodeId!

    expect(result.document.nodes[childId].parentId).toBe(document.rootId)
    expect(result.document.nodes[document.rootId].childIds).toContain(childId)
    expect(() => assertValidDocument(result.document)).not.toThrow()
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

  it('collapses and expands all descendant branches without hiding the target itself', () => {
    const document = createInitialDocument()
    const firstBranchId = document.nodes[document.rootId].childIds[0]
    const collapsed = executeCommand(document, { type: 'COLLAPSE_DESCENDANTS', nodeId: document.rootId }).document
    const expanded = executeCommand(collapsed, { type: 'EXPAND_DESCENDANTS', nodeId: document.rootId }).document

    expect(collapsed.nodes[document.rootId].collapsed).toBe(false)
    expect(collapsed.nodes[firstBranchId].collapsed).toBe(true)
    expect(expanded.nodes[firstBranchId].collapsed).toBe(false)
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
