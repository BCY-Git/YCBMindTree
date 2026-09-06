import { act, render, fireEvent, screen, waitFor } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapCanvas } from '../../editor/MindMapCanvas'
import { createInitialDocument } from '../../domain/document.factory'
import { useEditorStore } from '../../store/editor.store'

const nativeClipboard = vi.hoisted(() => ({ enabled: false, invoke: vi.fn() }))
vi.mock('../../platform/tauri', () => ({ isTauriRuntime: () => nativeClipboard.enabled }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: nativeClipboard.invoke }))

vi.mock('../../persistence/database', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../persistence/database')>(),
  saveNodeAttachment: vi.fn(async (_documentId: string, _nodeId: string, file: File) => ({ id: 'pasted-image', name: file.name, type: file.type, size: file.size, createdAt: 1 })),
}))
vi.mock('../../attachments/image-presentation', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../attachments/image-presentation')>(),
  readImagePresentation: vi.fn(async () => null),
}))

beforeEach(() => {
  nativeClipboard.enabled = false
  nativeClipboard.invoke.mockReset()
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
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '画布粘贴接收区' }))
  })

  it('adds the native pasted image to the selected node without Async Clipboard API', async () => {
    const mapDocument = useEditorStore.getState().document
    const selectedId = mapDocument.nodes[mapDocument.rootId].childIds[0]
    act(() => useEditorStore.getState().selectNode(selectedId))
    renderCanvas()
    dispatchCommandShortcut('v')
    fireEvent.paste(document.activeElement!, { clipboardData: { files: [new File(['png'], '截图.png', { type: 'image/png' })], items: [] } })
    await waitFor(() => expect(useEditorStore.getState().document.nodes[selectedId].attachments).toHaveLength(1))
    expect(useEditorStore.getState().document.nodes[selectedId].attachments[0].name).toBe('截图.png')
    act(() => useEditorStore.getState().undo())
    expect(useEditorStore.getState().document.nodes[selectedId].attachments).toHaveLength(0)
  })

  it('pastes desktop screenshots on Cmd+V even when WebKit emits no paste event', async () => {
    nativeClipboard.enabled = true
    nativeClipboard.invoke.mockResolvedValue(btoa('png-bytes'))
    const mapDocument = useEditorStore.getState().document
    const selectedId = mapDocument.rootId
    act(() => useEditorStore.getState().selectNode(selectedId))
    renderCanvas()
    const event = dispatchCommandShortcut('v')
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(useEditorStore.getState().document.nodes[selectedId].attachments).toHaveLength(1))
    expect(nativeClipboard.invoke).toHaveBeenCalledWith('read_clipboard_image')
  })

  it('does not steal Command+V or image paste from a text editor', () => {
    const view = renderCanvas()
    const input = document.createElement('textarea')
    view.container.append(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'v', metaKey: true })
    expect(document.activeElement).toBe(input)
    const event = new Event('paste', { bubbles: true, cancelable: true })
    act(() => input.dispatchEvent(event))
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
