/**
 * 核心领域类型定义 — MindTree 的所有持久化数据结构都在这里。
 *
 * - `MindNode`：思维导图的单个节点，包含 id、父子关系、主题文本、折叠状态、
 *   自由偏移量（用户手动拖拽产生的微调）以及创建/更新时间戳。
 * - `LayoutConfig`：布局参数，包含同级节点间距、层级间距，以及一个可选的
 *   freeformOffsets 快照（用于"恢复自由排布"功能）。
 * - `MindMapDocument`：整张导图的根对象，包含元数据（id、标题、创建时间）、
 *   根节点 ID、全部节点的 Record 字典、布局配置和当前主题。
 *
 * 注意：这些类型仅描述内存结构；所有时间戳均为 Unix 毫秒时间戳。
 */
import type { ThemeId } from './themes'

export type LayoutConfig = {
  levelGap: number
  siblingGap: number
  freeformOffsets: Record<string, { x: number; y: number }> | null
}

export type MindNode = {
  id: string
  parentId: string | null
  /** 脱离主树、可自由摆放的主题；拖到树枝附近后会重新成为普通节点。 */
  isFreeTopic: boolean
  childIds: string[]
  topic: string
  note: string
  links: MindNodeLink[]
  attachments: MindNodeAttachment[]
  /** 轻量任务状态；none 表示普通主题。 */
  taskStatus: MindNodeTaskStatus
  /** 0 表示未设置；1 最高，3 最低。 */
  priority: MindNodePriority
  /** 本地日期 YYYY-MM-DD；不设时间，避免跨时区意外偏移。 */
  dueDate: string | null
  /** 固定语义标记，适合快速扫读；与任务状态、优先级保持独立。 */
  marks: NodeMark[]
  /** 用户标签库的引用；找不到标签定义时保留引用但不渲染。 */
  tagIds: string[]
  collapsed: boolean
  /** 用户从右下角拖拽后的尺寸；null 时由标题内容自动计算。 */
  width: number | null
  height: number | null
  offsetX: number
  offsetY: number
  createdAt: number
  updatedAt: number
}

export type MindNodeTaskStatus = 'none' | 'todo' | 'doing' | 'done'
export type MindNodePriority = 0 | 1 | 2 | 3
export type NodeMark = 'flag' | 'star' | 'risk' | 'idea'

export type MindNodeLink = {
  id: string
  url: string
  label: string
}

/** 附件二进制保存在本地 IndexedDB；导图快照仅保存这份轻量元数据。 */
export type MindNodeAttachment = {
  id: string
  name: string
  type: string
  size: number
  createdAt: number
}

/** 独立于父子树结构的横向关联。sourceId / targetId 用于定位两端节点。 */
export type MindMapRelation = {
  id: string
  sourceId: string
  targetId: string
  label: string
  createdAt: number
  updatedAt: number
}

/** 同一父节点下的一组主题的视觉分组，不改变树结构。 */
export type MindMapBoundary = {
  id: string
  parentId: string
  nodeIds: string[]
  label: string
  createdAt: number
  updatedAt: number
}

/** 同级主题的汇总结论，不改变原有父子树。 */
export type MindMapSummary = {
  id: string
  parentId: string
  nodeIds: string[]
  topic: string
  createdAt: number
  updatedAt: number
}

export type MindMapDocument = {
  id: string
  schemaVersion: 1
  title: string
  categoryId: string
  /** 随手记草稿在本机保留，转为正式导图前不会参与云端同步。 */
  isDraft: boolean
  origin: 'standard' | 'quick-note'
  rootId: string
  nodes: Record<string, MindNode>
  relations: MindMapRelation[]
  boundaries: MindMapBoundary[]
  summaries: MindMapSummary[]
  layout: LayoutConfig
  theme: { id: ThemeId }
  createdAt: number
  updatedAt: number
}
