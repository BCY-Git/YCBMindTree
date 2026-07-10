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
  childIds: string[]
  topic: string
  collapsed: boolean
  offsetX: number
  offsetY: number
  createdAt: number
  updatedAt: number
}

export type MindMapDocument = {
  id: string
  schemaVersion: 1
  title: string
  categoryId: string
  rootId: string
  nodes: Record<string, MindNode>
  layout: LayoutConfig
  theme: { id: ThemeId }
  createdAt: number
  updatedAt: number
}
