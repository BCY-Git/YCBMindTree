import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { useEditorStore } from './editor.store'

describe('editor history', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'))
    const document = createInitialDocument()
    useEditorStore.setState({
      document,
      past: [],
      future: [],
      selectedNodeId: document.rootId,
      editingNodeId: null,
      clipboard: null,
      hydrated: true,
      lastHistoryMerge: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('merges consecutive edits to the same node into one undo step', () => {
    const { document, dispatch, undo } = useEditorStore.getState()
    const originalTopic = document.nodes[document.rootId].topic

    dispatch({ type: 'UPDATE_NODE_TOPIC', nodeId: document.rootId, topic: '第' })
    vi.advanceTimersByTime(300)
    dispatch({ type: 'UPDATE_NODE_TOPIC', nodeId: document.rootId, topic: '第一版标题' })

    expect(useEditorStore.getState().past).toHaveLength(1)
    undo()
    expect(useEditorStore.getState().document.nodes[document.rootId].topic).toBe(originalTopic)
  })

  it('starts a new undo step after the merge window expires', () => {
    const { document, dispatch } = useEditorStore.getState()

    dispatch({ type: 'RENAME_DOCUMENT', title: '第一次命名' })
    vi.advanceTimersByTime(1_001)
    dispatch({ type: 'RENAME_DOCUMENT', title: '第二次命名' })

    expect(useEditorStore.getState().past).toHaveLength(2)
    expect(document.title).toBe('未命名导图')
  })

  it('merges continuous layout slider changes by layout field', () => {
    const { document, dispatch, undo } = useEditorStore.getState()
    const originalGap = document.layout.levelGap

    dispatch({ type: 'UPDATE_LAYOUT', layout: { levelGap: 112 } })
    vi.advanceTimersByTime(200)
    dispatch({ type: 'UPDATE_LAYOUT', layout: { levelGap: 126 } })

    expect(useEditorStore.getState().past).toHaveLength(1)
    undo()
    expect(useEditorStore.getState().document.layout.levelGap).toBe(originalGap)
  })

  it('reports rejected commands so callers can reset transient UI state', () => {
    const { document, dispatch } = useEditorStore.getState()

    expect(dispatch({ type: 'DELETE_NODE', nodeId: document.rootId })).toBe(false)
    expect(useEditorStore.getState().document).toBe(document)
  })
})
