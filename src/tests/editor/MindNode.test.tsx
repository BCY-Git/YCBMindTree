import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReactFlowProvider } from '@xyflow/react'
import { MindNode, type MindNodeData } from '../../editor/MindNode'
import { useEditorStore } from '../../store/editor.store'
import { createInitialDocument } from '../../domain/document.factory'
import { saveAiSettings } from '../../ai/ai-settings'

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

afterEach(() => {
  act(() => useEditorStore.getState().editNode(null))
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('MindNode text editing', () => {
  it('moves focus and the caret to the text end after a double click anywhere on the node', async () => {
    const { container } = renderNode({ label: '双击后光标应到这里' }, nodeId, true)
    const label = container.querySelector('.node-label') as HTMLElement

    fireEvent.doubleClick(label)

    const input = await screen.findByRole('textbox') as HTMLTextAreaElement
    await waitFor(() => {
      expect(document.activeElement).toBe(input)
      expect(input.selectionStart).toBe(input.value.length)
      expect(input.selectionEnd).toBe(input.value.length)
    })
  })

  it('starts direct typing with the pressed character instead of appending to the old topic', () => {
    act(() => useEditorStore.getState().editNode(nodeId, 'X'))
    const data: MindNodeData = {
      label: '旧主题', isRoot: false, isFreeTopic: false, taskStatus: 'none', priority: 0,
      marks: [], tags: [], isDropTarget: false, hasChildren: false, collapsed: false,
      hiddenDescendantCount: 0, accentColor: '#467566', isRelationSource: false,
      semanticZoomLevel: 'workspace', depth: 0, layoutHeight: 44,
    }
    render(<ReactFlowProvider><MindNode id={nodeId} type="mind" data={data} selected={true} selectable deletable draggable dragging={false} zIndex={0} isConnectable positionAbsoluteX={0} positionAbsoluteY={0} /></ReactFlowProvider>)

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('X')
  })

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

  it('keeps editing and allows a line break on Shift+Enter', () => {
    renderEditingNode()
    const input = screen.getByRole('textbox') as HTMLTextAreaElement

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    expect(useEditorStore.getState().editingNodeId).toBe(nodeId)
  })
})

describe('MindNode tree branch anchor', () => {
  it('shows the number of all hidden descendants when a branch is collapsed', () => {
    renderNode({ hasChildren: true, collapsed: true, hiddenDescendantCount: 25 })

    expect(screen.getByRole('button', { name: '展开节点，包含 25 个隐藏分支' }).textContent).toBe('25')
  })

  it('places the expanded collapse control over the original curved branch anchor', () => {
    const { container } = renderNode({ hasChildren: true })

    expect(screen.getByRole('button', { name: '折叠节点' })).toBeTruthy()
    expect(container.querySelector('.collapse-toggle')?.classList.contains('is-collapsed')).toBe(false)
  })

  it('aligns the right source anchor with the node border beneath the collapse control', () => {
    const { container } = renderNode({ hasChildren: true })

    const sourceHandle = container.querySelector('.node-handle--source.react-flow__handle-right') as HTMLElement

    expect(sourceHandle.style.right).toBe('0px')
    expect(sourceHandle.style.transform).toBe('translate(50%, -50%)')
  })

  it('preserves React Flow positioning for the left source anchor', () => {
    const { container } = renderNode({ hasChildren: true })

    const sourceHandle = container.querySelector('.node-handle--source.react-flow__handle-left') as HTMLElement

    expect(sourceHandle.style.left).toBe('0px')
    expect(sourceHandle.style.transform).toBe('translate(-50%, -50%)')
  })
})

describe('MindNode quick actions', () => {
  it('can hide the floating toolbar while keeping add-topic buttons visible', () => {
    renderNode({ showQuickActions: true, floatingToolbarVisibility: 'never', showAddTopicButtons: true, canAddChild: true }, nodeId, true)

    expect(screen.queryByRole('button', { name: '扩展想法' })).toBeNull()
    expect(screen.getByRole('button', { name: '添加子节点' })).toBeDefined()
  })

  it('shows the floating toolbar only while hovering in hover mode', () => {
    const { container } = renderNode({ showQuickActions: true, floatingToolbarVisibility: 'hover', showAddTopicButtons: false }, nodeId, true)
    const node = container.querySelector('.mind-node') as HTMLElement

    expect(screen.queryByRole('button', { name: '扩展想法' })).toBeNull()
    fireEvent.mouseEnter(node)
    expect(screen.getByRole('button', { name: '扩展想法' })).toBeDefined()
    fireEvent.mouseLeave(node)
    expect(screen.queryByRole('button', { name: '扩展想法' })).toBeNull()
  })

  it('adds a child from the right plus button and immediately edits it', () => {
    const document = useEditorStore.getState().document
    const parentId = document.nodes[document.rootId].childIds[0]
    const before = document.nodes[parentId].childIds.length
    renderNode({ showQuickActions: true, canAddChild: true, canAddSibling: true }, parentId, true)

    fireEvent.click(screen.getByRole('button', { name: '添加子节点' }))

    const current = useEditorStore.getState()
    expect(current.document.nodes[parentId].childIds).toHaveLength(before + 1)
    expect(current.editingNodeId).toBe(current.document.nodes[parentId].childIds.at(-1))
  })

  it('adds a sibling from the bottom plus button', () => {
    const document = useEditorStore.getState().document
    const parentId = document.nodes[document.rootId].childIds[0]
    const nodeId = document.nodes[parentId].childIds[0]
    const before = document.nodes[parentId].childIds.length
    renderNode({ showQuickActions: true, canAddChild: true, canAddSibling: true }, nodeId, true)

    fireEvent.click(screen.getByRole('button', { name: '添加同级节点' }))

    expect(useEditorStore.getState().document.nodes[parentId].childIds).toHaveLength(before + 1)
  })

  it('uses AI expansion to insert exactly three direct children', async () => {
    const document = useEditorStore.getState().document
    const parentId = document.nodes[document.rootId].childIds[0]
    const before = document.nodes[parentId].childIds.length
    saveAiSettings({ endpoint: 'https://api.deepseek.com', model: 'test-model', apiKey: 'sk-test' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"ideas":["切入点","关键风险","下一步"]}' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    renderNode({ showQuickActions: true, canAddChild: true, canAddSibling: true }, parentId, true)

    fireEvent.click(screen.getByRole('button', { name: '扩展想法' }))

    await waitFor(() => expect(useEditorStore.getState().document.nodes[parentId].childIds).toHaveLength(before + 3))
    const childIds = useEditorStore.getState().document.nodes[parentId].childIds.slice(before)
    expect(childIds.map((id) => useEditorStore.getState().document.nodes[id].topic)).toEqual(['切入点', '关键风险', '下一步'])
    expect(screen.getByText('已生成 3 个直接子节点')).toBeDefined()
  })
})

describe('MindNode relation handles', () => {
  it('exposes dedicated source handles for direct drag-to-connect', () => {
    const { container } = renderNode({}, 'source-node', true)

    const sourceHandles = container.querySelectorAll('.node-handle--relation-source.source')

    expect(sourceHandles).toHaveLength(2)
    sourceHandles.forEach((handle) => expect(handle.classList.contains('connectable')).toBe(true))
    expect(screen.getAllByLabelText('拖动建立关系')).toHaveLength(2)
  })

  it('allows relation targets to receive a dragged relation endpoint', () => {
    const { container } = renderNode()

    const targetHandles = container.querySelectorAll('.node-handle--relation.target')

    expect(targetHandles).toHaveLength(2)
    targetHandles.forEach((handle) => expect(handle.classList.contains('connectable')).toBe(true))
  })

  it('marks a valid click-mode target without changing its document data', () => {
    const { container } = renderNode({ relationTargetState: 'available' })

    expect(container.querySelector('.mind-node')?.classList.contains('is-relation-target-available')).toBe(true)
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
