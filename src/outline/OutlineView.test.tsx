import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createInitialDocument, createNode } from '../domain/document.factory'
import { useEditorStore } from '../store/editor.store'
import { OutlineView } from './OutlineView'

function outlineDocument() {
  const document = createInitialDocument()
  const root = document.nodes[document.rootId]
  const branch = createNode('第一分支', root.id)
  const child = createNode('分支结论', branch.id)
  branch.childIds = [child.id]
  root.childIds = [branch.id]
  document.nodes = { [root.id]: root, [branch.id]: branch, [child.id]: child }
  return { document, branch, child }
}

describe('OutlineView', () => {
  it('folds a branch through the shared document command state', () => {
    const fixture = outlineDocument()
    act(() => useEditorStore.getState().hydrate(fixture.document))
    render(<OutlineView tags={[]} />)

    expect(screen.getByDisplayValue('分支结论')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '折叠 第一分支' }))

    expect(useEditorStore.getState().document.nodes[fixture.branch.id].collapsed).toBe(true)
    expect(screen.queryByDisplayValue('分支结论')).toBeNull()
  })

  it('edits node text and task state through the shared command layer', () => {
    const fixture = outlineDocument()
    act(() => useEditorStore.getState().hydrate(fixture.document))
    render(<OutlineView tags={[]} />)

    fireEvent.change(screen.getByDisplayValue('第一分支'), { target: { value: '更新后的分支' } })
    fireEvent.click(screen.getByRole('button', { name: '更新后的分支：普通主题' }))

    expect(useEditorStore.getState().document.nodes[fixture.branch.id]).toMatchObject({ topic: '更新后的分支', taskStatus: 'todo' })
  })

  it('creates a sibling with Enter while editing the outline', () => {
    const fixture = outlineDocument()
    act(() => useEditorStore.getState().hydrate(fixture.document))
    render(<OutlineView tags={[]} />)

    fireEvent.keyDown(screen.getByDisplayValue('第一分支'), { key: 'Enter' })

    expect(useEditorStore.getState().document.nodes[fixture.document.rootId].childIds).toHaveLength(2)
    expect(screen.getByDisplayValue('新节点')).toBeTruthy()
  })

  it('reorders siblings with Alt and arrow keys', () => {
    const fixture = outlineDocument()
    act(() => useEditorStore.getState().hydrate(fixture.document))
    render(<OutlineView tags={[]} />)
    fireEvent.keyDown(screen.getByDisplayValue('第一分支'), { key: 'Enter' })
    const createdId = useEditorStore.getState().document.nodes[fixture.document.rootId].childIds[1]

    fireEvent.keyDown(screen.getByDisplayValue('新节点'), { key: 'ArrowUp', altKey: true })

    expect(useEditorStore.getState().document.nodes[fixture.document.rootId].childIds).toEqual([createdId, fixture.branch.id])
  })

  it('keeps workspace search available in outline mode', async () => {
    const fixture = outlineDocument()
    act(() => useEditorStore.getState().hydrate(fixture.document))
    render(<OutlineView tags={[]} workspaceDocuments={[fixture.document]} />)

    await act(async () => { fireEvent.keyDown(window, { key: 'f', metaKey: true }) })

    expect(screen.getByRole('dialog', { name: '搜索工作区' })).toBeTruthy()
  })
})
