import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReactFlowProvider } from '@xyflow/react'
import { MindNode, type MindNodeData } from './MindNode'
import { useEditorStore } from '../store/editor.store'

const nodeId = 'node-under-edit'

function renderEditingNode() {
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
    layoutHeight: 44,
  }
  return render(<ReactFlowProvider><MindNode id={nodeId} type="mind" data={data} selected={true} selectable deletable draggable dragging={false} zIndex={0} isConnectable positionAbsoluteX={0} positionAbsoluteY={0} /></ReactFlowProvider>)
}

function renderNode(dataOverrides: Partial<MindNodeData> = {}) {
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
    layoutHeight: 44,
    ...dataOverrides,
  }
  return render(<ReactFlowProvider><MindNode id="parent-node" type="mind" data={data} selected={false} selectable deletable draggable dragging={false} zIndex={0} isConnectable positionAbsoluteX={0} positionAbsoluteY={0} /></ReactFlowProvider>)
}

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
