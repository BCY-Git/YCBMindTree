import { act, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapCanvas } from '../../editor/MindMapCanvas'
import { createInitialDocument } from '../../domain/document.factory'
import { useEditorStore } from '../../store/editor.store'

beforeEach(() => {
  const document = createInitialDocument()
  act(() => useEditorStore.getState().hydrate(document))
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

describe('MindMapCanvas clipboard shortcuts', () => {
  function renderCanvas() {
    const mapDocument = useEditorStore.getState().document
    return render(
      <ReactFlowProvider>
        <MindMapCanvas
          workspaceDocuments={[mapDocument]}
          onRevealWorkspaceNode={vi.fn()}
        />
      </ReactFlowProvider>,
    )
  }

  function dispatchCommandShortcut(key: string) {
    const event = new KeyboardEvent('keydown', {
      key,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => document.body.dispatchEvent(event))
    return event
  }

  it('lets Command+V produce the native paste event', () => {
    renderCanvas()
    const event = dispatchCommandShortcut('v')

    expect(event.defaultPrevented).toBe(false)
  })

  it('keeps Command+C routed to the selected MindTree branch', () => {
    const mapDocument = useEditorStore.getState().document
    const selectedId = mapDocument.nodes[mapDocument.rootId].childIds[0]
    act(() => useEditorStore.getState().selectNode(selectedId))
    renderCanvas()

    const event = dispatchCommandShortcut('c')

    expect(event.defaultPrevented).toBe(true)
    expect(useEditorStore.getState().clipboard?.topic).toBe(mapDocument.nodes[selectedId].topic)
    expect(useEditorStore.getState().document.nodes[selectedId]).toBeDefined()
  })

  it('keeps Command+X routed to the selected MindTree branch', () => {
    const mapDocument = useEditorStore.getState().document
    const selectedId = mapDocument.nodes[mapDocument.rootId].childIds[0]
    act(() => useEditorStore.getState().selectNode(selectedId))
    renderCanvas()

    const event = dispatchCommandShortcut('x')

    expect(event.defaultPrevented).toBe(true)
    expect(useEditorStore.getState().clipboard?.topic).toBe(mapDocument.nodes[selectedId].topic)
    expect(useEditorStore.getState().document.nodes[selectedId]).toBeUndefined()
  })
})
