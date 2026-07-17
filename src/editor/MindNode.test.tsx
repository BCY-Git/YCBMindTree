import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReactFlowProvider } from '@xyflow/react'
import { MindNode, type MindNodeData } from './MindNode'
import { useEditorStore } from '../store/editor.store'
import { createInitialDocument } from '../domain/document.factory'

const nodeId = 'node-under-edit'

function renderEditingNode(dataOverrides: Partial<MindNodeData> = {}) {
  act(() => useEditorStore.getState().editNode(nodeId))
  const data: MindNodeData = {
    label: '需要全选的节点文本',
    isRoot: false,
    isFreeTopic: false,
    taskStatus: 'none',
    priority: 0,
    marks: [],
    tags: [],
    isDropTarget: false,
    hasChildren: false,
    collapsed: false,
    hiddenDescendantCount: 0,
    accentColor: '#467566',
    isRelationSource: false,
    semanticZoomLevel: 'workspace',
    depth: 0,
    layoutHeight: 44,
    ...dataOverrides,
  }
  return render(<ReactFlowProvider><MindNode id={nodeId} type="mind" data={data} selected={true} selectable deletable draggable dragging={false} zIndex={0} isConnectable positionAbsoluteX={0} positionAbsoluteY={0} /></ReactFlowProvider>)
}

function renderNode(dataOverrides: Partial<MindNodeData> = {}, id = 'parent-node', selected = false) {
  const data: MindNodeData = {
    label: '父节点',
    isRoot: false,
    isFreeTopic: false,
    taskStatus: 'none',
    priority: 0,
    marks: [],
    tags: [],
    isDropTarget: false,
    hasChildren: false,
    collapsed: false,
    hiddenDescendantCount: 0,
    accentColor: '#467566',
    isRelationSource: false,
    semanticZoomLevel: 'workspace',
    depth: 0,
    layoutHeight: 44,
    ...dataOverrides,
  }
  return render(<ReactFlowProvider><MindNode id={id} type="mind" data={data} selected={selected} selectable deletable draggable dragging={false} zIndex={0} isConnectable positionAbsoluteX={0} positionAbsoluteY={0} /></ReactFlowProvider>)
}

beforeEach(() => {
  const document = createInitialDocument()
  useEditorStore.getState().hydrate(document)
})

afterEach(() => act(() => useEditorStore.getState().editNode(null)))

describe('MindNode text editing', () => {
  it('uses Command+A inside an editing node to select only its text', () => {
    const onWindowKeyDown = vi.fn()
    window.addEventListener('keydown', onWindowKeyDown)
    try {
      renderEditingNode()
      const input = screen.getByRole('textbox') as HTMLTextAreaElement
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)

      fireEvent.keyDown(input, { key: 'a', metaKey: true })

      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(input.value.length)
      expect(onWindowKeyDown).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', onWindowKeyDown)
    }
  })

  it('keeps a single-line editor vertically centered inside a manually enlarged node', () => {
    const { container } = renderEditingNode({ layoutHeight: 120 })
    const shell = container.querySelector('.node-input-shell') as HTMLElement
    const input = screen.getByRole('textbox') as HTMLTextAreaElement

    expect(shell.style.minHeight).toBe('104px')
    expect(shell.style.alignItems).toBe('center')
    expect(input.style.height).toBe('19px')
  })
})

describe('MindNode tree branch anchor', () => {
  it('shows the number of all hidden descendants when a branch is collapsed', () => {
    renderNode({ hasChildren: true, collapsed: true, hiddenDescendantCount: 25 })

    expect(screen.getByRole('button', { name: '展开节点，包含 25 个隐藏分支' }).textContent).toBe('25')
  })

  it('places the expanded collapse control over the original curved branch anchor', () => {
    renderNode({ hasChildren: true })

    expect((screen.getByRole('button', { name: '折叠节点' }) as HTMLElement).style.right).toBe('-13px')
  })

  it('keeps the right source anchor at the original curved branch position', () => {
    const { container } = renderNode({ hasChildren: true })

    const sourceHandle = container.querySelector('.node-handle--source.react-flow__handle-right') as HTMLElement

    expect(sourceHandle.style.right).toBe('-4px')
    expect(sourceHandle.style.transform).toBe('translate(50%, -50%)')
  })

  it('preserves React Flow positioning for the left source anchor', () => {
    const { container } = renderNode({ hasChildren: true })

    const sourceHandle = container.querySelector('.node-handle--source.react-flow__handle-left') as HTMLElement

    expect(sourceHandle.style.transform).toBe('translate(-50%, -50%)')
  })
})

describe('MindNode relation handles', () => {
  it('allows relation targets to receive a dragged relation endpoint', () => {
    const { container } = renderNode()

    const targetHandles = container.querySelectorAll('.node-handle--relation.target')

    expect(targetHandles).toHaveLength(2)
    targetHandles.forEach((handle) => expect(handle.classList.contains('connectable')).toBe(true))
  })
})

describe('MindNode task markers', () => {
  it('lets the user change task status directly from the visible task marker', () => {
    const document = useEditorStore.getState().document
    const nodeId = document.nodes[document.rootId].childIds[0]
    act(() => useEditorStore.getState().dispatch({ type: 'SET_NODE_TASK_STATUS', nodeId, taskStatus: 'todo' }))
    renderNode({ taskStatus: 'todo' }, nodeId)

    fireEvent.click(screen.getByRole('button', { name: '任务状态：待办，点击修改' }))
    expect(useEditorStore.getState().selectedNodeId).toBe(nodeId)
    fireEvent.click(screen.getByRole('menuitem', { name: '进行中' }))

    expect(useEditorStore.getState().document.nodes[nodeId].taskStatus).toBe('doing')
    expect(useEditorStore.getState().past).not.toHaveLength(0)
  })

  it('lets the user choose priority and offers a clear option from the visible marker', () => {
    const document = useEditorStore.getState().document
    const nodeId = document.nodes[document.rootId].childIds[0]
    act(() => useEditorStore.getState().dispatch({ type: 'SET_NODE_PRIORITY', nodeId, priority: 1 }))
    renderNode({ priority: 1 }, nodeId)

    fireEvent.click(screen.getByRole('button', { name: '优先级 P1，点击修改' }))
    expect(screen.getByRole('menuitem', { name: '未设置' })).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: 'P2 · 中' }))

    expect(useEditorStore.getState().document.nodes[nodeId].priority).toBe(2)
  })
})

describe('MindNode semantic zoom', () => {
  it('keeps only the topic and collapse control in overview detail', () => {
    renderNode({ semanticZoomLevel: 'overview', taskStatus: 'todo', priority: 1, hasChildren: true })

    expect(screen.getByText('父节点')).toBeDefined()
    expect(screen.getByRole('button', { name: '折叠节点' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '任务状态：待办，点击修改' })).toBeNull()
    expect(screen.queryByText('P1')).toBeNull()
  })

  it('shows compact non-interactive signals in structure detail', () => {
    const { container } = renderNode({ semanticZoomLevel: 'structure', taskStatus: 'doing', priority: 2 })

    expect(container.querySelector('.node-semantic-signals')?.textContent).toContain('◐')
    expect(container.querySelector('.node-semantic-signals')?.textContent).toContain('P2')
    expect(screen.queryByRole('button', { name: '任务状态：进行中，点击修改' })).toBeNull()
  })

  it('restores full node controls when an overview node is selected', () => {
    renderNode({ semanticZoomLevel: 'overview', taskStatus: 'todo', priority: 1 }, 'selected-node', true)

    expect(screen.getByRole('button', { name: '任务状态：待办，点击修改' })).toBeDefined()
    expect(screen.getByRole('button', { name: '优先级 P1，点击修改' })).toBeDefined()
  })

  it('renders deep overview nodes as context while preserving the full selected node', () => {
    const deep = renderNode({ semanticZoomLevel: 'overview', depth: 4 })
    expect(deep.container.querySelector('.mind-node')?.classList.contains('mind-node--emphasis-context')).toBe(true)
    deep.unmount()

    const selected = renderNode({ semanticZoomLevel: 'overview', depth: 4 }, 'selected-deep-node', true)
    expect(selected.container.querySelector('.mind-node')?.classList.contains('mind-node--emphasis-full')).toBe(true)
  })
})
