/**
 * 文档工厂 — 构造新的 MindNode 和 MindMapDocument 实例。
 *
 * `createNode(topic, parentId)`：创建独立节点，分配随机 UUID，
 * 初始化空的 childIds、展开状态和零偏移量。
 *
 * `createInitialDocument()`：构建演示文档（包含根节点、一级提示节点），
 * 用于首次启动时给用户展示基本操作方式。
 */
import type { MindMapDocument, MindNode } from './document.types'

const id = () => crypto.randomUUID()

// 用 `crypto.randomUUID()` 生成唯一 ID，无需引入额外依赖。
export function createNode(topic: string, parentId: string | null): MindNode {
  const now = Date.now()
  return {
    id: id(),
    parentId,
    isFreeTopic: false,
    childIds: [],
    topic,
    note: '',
    links: [],
    attachments: [],
    taskStatus: 'none',
    priority: 0,
    dueDate: null,
    marks: [],
    tagIds: [],
    collapsed: false,
    width: null,
    height: null,
    offsetX: 0,
    offsetY: 0,
    createdAt: now,
    updatedAt: now,
  }
}

// 构建演示文档：根 → "从这里开始" → 两个子节点分别介绍 Tab/Enter 快捷键。
export function createInitialDocument(): MindMapDocument {
  const root = createNode('我的思维导图', null)
  const first = createNode('从这里开始', root.id)
  const second = createNode('按 Tab 创建子节点', first.id)
  const third = createNode('按 Enter 创建同级节点', first.id)
  first.childIds = [second.id, third.id]
  root.childIds = [first.id]
  const now = Date.now()
  return {
    id: id(),
    schemaVersion: 1,
    title: '未命名导图',
    categoryId: 'uncategorized',
    isDraft: false,
    origin: 'standard',
    rootId: root.id,
    nodes: { [root.id]: root, [first.id]: first, [second.id]: second, [third.id]: third },
    relations: [],
    boundaries: [],
    summaries: [],
    layout: { levelGap: 96, siblingGap: 22, freeformOffsets: null },
    theme: { id: 'calm' },
    createdAt: now,
    updatedAt: now,
  }
}

/** 创建一个没有教学节点的随手记草稿，直接从中心主题开始组织想法。 */
export function createQuickNoteDocument(): MindMapDocument {
  const root = createNode('随手记', null)
  const now = Date.now()
  const stamp = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  return {
    id: id(),
    schemaVersion: 1,
    title: `随手记 · ${stamp}`,
    categoryId: 'uncategorized',
    isDraft: true,
    origin: 'quick-note',
    rootId: root.id,
    nodes: { [root.id]: root },
    relations: [],
    boundaries: [],
    summaries: [],
    layout: { levelGap: 96, siblingGap: 22, freeformOffsets: null },
    theme: { id: 'calm' },
    createdAt: now,
    updatedAt: now,
  }
}
