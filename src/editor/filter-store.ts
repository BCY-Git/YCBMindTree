import { create } from 'zustand'
import type { MindNodePriority, MindNodeTaskStatus, NodeMark } from '../domain/document.types'

export type NodeFilter = {
  tags: string[]
  marks: NodeMark[]
  statuses: MindNodeTaskStatus[]
  priorities: MindNodePriority[]
}

export const emptyNodeFilter: NodeFilter = { tags: [], marks: [], statuses: [], priorities: [] }

export function hasActiveFilter(filter: NodeFilter) {
  return filter.tags.length > 0 || filter.marks.length > 0 || filter.statuses.length > 0 || filter.priorities.length > 0
}

export const useNodeFilterStore = create<{
  filter: NodeFilter
  setFilter: (filter: NodeFilter) => void
  clearFilter: () => void
}>((set) => ({
  filter: emptyNodeFilter,
  setFilter: (filter) => set({ filter }),
  clearFilter: () => set({ filter: emptyNodeFilter }),
}))
