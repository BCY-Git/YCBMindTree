/**
 * 编辑器全局状态（Zustand）。
 *
 * 单一数据源：存储当前 document、undo/redo 历史栈、选中/编辑中节点 id、
 * 剪贴板内容、以及 IndexedDB 持久化状态（hydrated 标志）。
 *
 * 核心操作：
 * - dispatch(command)：执行命令 → 保存旧文档到 past → 推入新文档 → 记录焦点
 * - undo/redo：从 past/future 栈中恢复历史文档
 * - copyNode/cutNode/pasteIntoNode：基于 createNodeClipboard 实现
 * - hydrate(doc)：从 IndexedDB 加载后初始化，清空历史栈
 * - createDocument()：创建新文档，覆盖当前内容，清空历史
 *
 * 历史栈最多保留 50 条（past.length ≤ 50），超出时丢弃最旧条目。
 */
import { create } from 'zustand'
import { createInitialDocument, createQuickNoteDocument } from '../domain/document.factory'
import { createNodeClipboard, executeCommand, type MindMapCommand, type MindNodeClipboard } from '../domain/commands'
import type { MindMapDocument } from '../domain/document.types'

type EditorState = {
  document: MindMapDocument
  past: MindMapDocument[]   // undo 栈
  future: MindMapDocument[] // redo 栈
  pastDepositBatchIds: Array<string | null>
  futureDepositBatchIds: Array<string | null>
  selectedNodeId: string | null
  selectedNodeIds: string[]
  selectedRelationId: string | null
  focusRequestNodeId: string | null
  relationCreationRequestSourceIds: string[]
  editingNodeId: string | null
  clipboard: MindNodeClipboard | null
  hydrated: boolean
  lastHistoryMerge: { key: string; at: number } | null
  dispatch: (command: MindMapCommand) => boolean
  undo: () => void
  redo: () => void
  selectNode: (id: string | null, additive?: boolean) => void
  setSelectedNodes: (ids: string[]) => void
  selectRelation: (id: string | null) => void
  requestNodeFocus: (id: string) => void
  clearNodeFocusRequest: () => void
  requestRelatedTopic: (sourceIds: string[]) => void
  clearRelationCreationRequest: () => void
  editNode: (id: string | null) => void
  hydrate: (document: MindMapDocument) => void
  copyNode: (nodeId: string) => void
  cutNode: (nodeId: string) => void
  pasteIntoNode: (parentId: string) => void
  insertGeneratedBranch: (parentId: string, branch: MindNodeClipboard) => boolean
  createDocument: () => void
  createQuickNote: () => void
}

const initialDocument = createInitialDocument()

function historyMergeKey(command: MindMapCommand): string | null {
  switch (command.type) {
    case 'UPDATE_NODE_TOPIC': return `topic:${command.nodeId}`
    case 'UPDATE_NODE_NOTE': return `note:${command.nodeId}`
    case 'UPDATE_RELATION_LABEL': return `relation:${command.relationId}`
    case 'RENAME_DOCUMENT': return 'document-title'
    case 'UPDATE_LAYOUT': return `layout:${Object.keys(command.layout).sort().join(',')}`
    default: return null
  }
}

function shouldEditFocusedNode(command: MindMapCommand) {
  return command.type === 'ADD_CHILD' || command.type === 'ADD_SIBLING' || command.type === 'ADD_FREE_TOPIC' || command.type === 'CREATE_RELATED_FREE_TOPIC' || command.type === 'PASTE_SUBTREE'
}

const historyMergeWindowMs = 1_000

function notifyDepositHistory(batchId: string | null | undefined, applied: boolean) {
  if (!batchId || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('mindtree:deposit-history', { detail: { batchId, applied } }))
}

export const useEditorStore = create<EditorState>((set, get) => ({
  document: initialDocument,
  past: [],
  future: [],
  pastDepositBatchIds: [],
  futureDepositBatchIds: [],
  selectedNodeId: initialDocument.rootId,
  selectedNodeIds: [initialDocument.rootId],
  selectedRelationId: null,
  focusRequestNodeId: null,
  relationCreationRequestSourceIds: [],
  editingNodeId: null,
  clipboard: null,
  hydrated: false,
  lastHistoryMerge: null,
  // dispatch：命令执行的统一入口，同时维护 undo/redo 栈。
  // 执行后保存旧文档到 past 栈（最多 50 条），清空 redo 栈，更新选中/编辑焦点。
  dispatch: (command) => {
    const state = get()
    try {
      const result = executeCommand(state.document, command)
      const mergeKey = historyMergeKey(command)
      const shouldMerge = mergeKey !== null
        && state.lastHistoryMerge?.key === mergeKey
        && Date.now() - state.lastHistoryMerge.at < historyMergeWindowMs
      set({
        document: result.document,
        past: shouldMerge ? state.past : [...state.past.slice(-49), state.document],
        future: [],
        pastDepositBatchIds: shouldMerge ? state.pastDepositBatchIds : [...state.pastDepositBatchIds.slice(-49), command.type === 'APPLY_DEPOSIT_OPERATIONS' ? command.batchId : null],
        futureDepositBatchIds: [],
        selectedNodeId: result.focusNodeId ?? state.selectedNodeId,
        selectedNodeIds: result.focusNodeId ? [result.focusNodeId] : state.selectedNodeIds.filter((id) => Boolean(result.document.nodes[id])),
        selectedRelationId: result.focusRelationId ?? (state.selectedRelationId && result.document.relations.some((relation) => relation.id === state.selectedRelationId) ? state.selectedRelationId : null),
        editingNodeId: shouldEditFocusedNode(command) ? result.focusNodeId ?? null : null,
        focusRequestNodeId: null,
        lastHistoryMerge: mergeKey ? { key: mergeKey, at: Date.now() } : null,
      })
      return true
    } catch (error) {
      console.warn(error)
      return false
    }
  },
  // undo：从 past 栈恢复上一份文档，将当前文档推入 future 栈。
  undo: () => {
    const state = get()
    const previous = state.past.at(-1)
    if (!previous) return
    const batchId = state.pastDepositBatchIds.at(-1) ?? null
    set({ document: previous, past: state.past.slice(0, -1), future: [state.document, ...state.future], pastDepositBatchIds: state.pastDepositBatchIds.slice(0, -1), futureDepositBatchIds: [batchId, ...state.futureDepositBatchIds], lastHistoryMerge: null })
    notifyDepositHistory(batchId, false)
  },
  // redo：从 future 栈取出下一份文档，将当前文档推入 past 栈。
  redo: () => {
    const state = get()
    const next = state.future[0]
    if (!next) return
    const batchId = state.futureDepositBatchIds[0] ?? null
    set({ document: next, past: [...state.past, state.document], future: state.future.slice(1), pastDepositBatchIds: [...state.pastDepositBatchIds, batchId], futureDepositBatchIds: state.futureDepositBatchIds.slice(1), lastHistoryMerge: null })
    notifyDepositHistory(batchId, true)
  },
  selectNode: (id, additive = false) => set((state) => {
    if (!id) return { selectedNodeId: null, selectedNodeIds: [], selectedRelationId: null }
    if (!additive) return { selectedNodeId: id, selectedNodeIds: [id], selectedRelationId: null }
    const selectedNodeIds = state.selectedNodeIds.includes(id)
      ? state.selectedNodeIds.filter((current) => current !== id)
      : [...state.selectedNodeIds, id]
    return { selectedNodeId: selectedNodeIds.includes(id) ? id : (selectedNodeIds.at(-1) ?? null), selectedNodeIds, selectedRelationId: null }
  }),
  setSelectedNodes: (ids) => set((state) => {
    const selectedNodeIds = [...new Set(ids)].filter((id) => Boolean(state.document.nodes[id]))
    const unchanged = selectedNodeIds.length === state.selectedNodeIds.length
      && selectedNodeIds.every((id, index) => id === state.selectedNodeIds[index])
      && state.selectedNodeId === (selectedNodeIds.at(-1) ?? null)
      && state.selectedRelationId === null
      && state.editingNodeId === null
    // React Flow 会在 nodes props 同步时重复通知选择状态；相同选择必须是无操作，
    // 否则会产生「同步节点 → 通知选择 → 重算节点」的更新循环。
    if (unchanged) return state
    return { selectedNodeId: selectedNodeIds.at(-1) ?? null, selectedNodeIds, selectedRelationId: null, editingNodeId: null }
  }),
  selectRelation: (id) => set({ selectedRelationId: id, selectedNodeId: null, selectedNodeIds: [], editingNodeId: null }),
  requestNodeFocus: (id) => set({ selectedNodeId: id, selectedNodeIds: [id], selectedRelationId: null, editingNodeId: null, focusRequestNodeId: id }),
  clearNodeFocusRequest: () => set({ focusRequestNodeId: null }),
  requestRelatedTopic: (sourceIds) => set({ relationCreationRequestSourceIds: [...new Set(sourceIds)] }),
  clearRelationCreationRequest: () => set({ relationCreationRequestSourceIds: [] }),
  // editNode：进入编辑态，同时选中该节点；传 null 则退出编辑态。
  editNode: (id) => set({ editingNodeId: id, selectedNodeId: id, selectedNodeIds: id ? [id] : [], selectedRelationId: null }),
  // copyNode：将节点及子树序列化为剪贴板，不修改文档。
  copyNode: (nodeId) => {
    const state = get()
    try { set({ clipboard: createNodeClipboard(state.document, nodeId) }) } catch (error) { console.warn(error) }
  },
  cutNode: (nodeId) => {
    const state = get()
    if (nodeId === state.document.rootId) return
    try {
      const clipboard = createNodeClipboard(state.document, nodeId)
      const result = executeCommand(state.document, { type: 'DELETE_NODE', nodeId })
      set({
        clipboard,
        document: result.document,
        past: [...state.past.slice(-49), state.document],
        future: [],
        pastDepositBatchIds: [...state.pastDepositBatchIds.slice(-49), null],
        futureDepositBatchIds: [],
        selectedNodeId: result.focusNodeId ?? state.selectedNodeId,
        selectedNodeIds: result.focusNodeId ? [result.focusNodeId] : state.selectedNodeIds,
        selectedRelationId: null,
        editingNodeId: null,
        focusRequestNodeId: null,
        lastHistoryMerge: null,
      })
    } catch (error) { console.warn(error) }
  },
  pasteIntoNode: (parentId) => {
    const state = get()
    if (!state.clipboard) return
    try {
      const result = executeCommand(state.document, { type: 'PASTE_SUBTREE', parentId, clipboard: state.clipboard })
      set({
        document: result.document,
        past: [...state.past.slice(-49), state.document],
        future: [],
        pastDepositBatchIds: [...state.pastDepositBatchIds.slice(-49), null],
        futureDepositBatchIds: [],
        selectedNodeId: result.focusNodeId ?? state.selectedNodeId,
        selectedNodeIds: result.focusNodeId ? [result.focusNodeId] : state.selectedNodeIds,
        selectedRelationId: null,
        editingNodeId: null,
        focusRequestNodeId: null,
        lastHistoryMerge: null,
      })
    } catch (error) { console.warn(error) }
  },
  insertGeneratedBranch: (parentId, branch) => {
    const state = get()
    try {
      const result = executeCommand(state.document, { type: 'PASTE_SUBTREE', parentId, clipboard: branch })
      set({
        document: result.document,
        past: [...state.past.slice(-49), state.document],
        future: [],
        pastDepositBatchIds: [...state.pastDepositBatchIds.slice(-49), null],
        futureDepositBatchIds: [],
        selectedNodeId: result.focusNodeId ?? state.selectedNodeId,
        selectedNodeIds: result.focusNodeId ? [result.focusNodeId] : state.selectedNodeIds,
        selectedRelationId: null,
        editingNodeId: null,
        focusRequestNodeId: null,
        lastHistoryMerge: null,
      })
      return true
    } catch (error) {
      console.warn(error)
      return false
    }
  },
  createDocument: () => {
    const document = createInitialDocument()
    set({
      document,
      past: [],
      future: [],
      pastDepositBatchIds: [],
      futureDepositBatchIds: [],
      selectedNodeId: document.rootId,
      selectedNodeIds: [document.rootId],
      selectedRelationId: null,
      editingNodeId: document.rootId,
      focusRequestNodeId: null,
      clipboard: null,
      hydrated: true,
      lastHistoryMerge: null,
    })
  },
  createQuickNote: () => {
    const document = createQuickNoteDocument()
    set({
      document,
      past: [],
      future: [],
      pastDepositBatchIds: [],
      futureDepositBatchIds: [],
      selectedNodeId: document.rootId,
      selectedNodeIds: [document.rootId],
      selectedRelationId: null,
      editingNodeId: document.rootId,
      focusRequestNodeId: null,
      clipboard: null,
      hydrated: true,
      lastHistoryMerge: null,
    })
  },
  hydrate: (document) => set({
    document,
    past: [],
    future: [],
    pastDepositBatchIds: [],
    futureDepositBatchIds: [],
    selectedNodeId: document.rootId,
    selectedNodeIds: [document.rootId],
    selectedRelationId: null,
    editingNodeId: null,
    focusRequestNodeId: null,
    clipboard: null,
    hydrated: true,
    lastHistoryMerge: null,
  }),
}))
