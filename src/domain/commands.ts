/**
 * 命令系统 — MindTree 的唯一状态变更入口。
 *
 * 所有对导图的修改（增删节点、重命名、拖拽、折叠、复制粘贴、主题切换……）
 * 都通过派发一个 MindMapCommand 来完成。executeCommand(source, command) 接收
 * 当前文档的深拷贝，应用命令逻辑，返回新文档及可选的焦点节点 ID。
 *
 * 关键保证：
 * - 每条命令执行后调用 assertValidDocument，异常直接抛出
 * - 文档更新统一由 touch() 更新时间戳
 * - copy/paste/indent/outdent 等操作通过 moveNode / pasteSubtree 实现
 * - AUTO_ARRANGE 先保存当前自由偏移快照，再清除所有 offset，以便自动布局
 *   接管；RESTORE_FREEFORM_LAYOUT 从快照恢复，实现"排列后可撤销"
 */
import { createNode } from './document.factory'
import { assertValidDocument } from './document.validator'
import type { LayoutConfig, MindMapBoundary, MindMapDocument, MindMapRelation, MindNodeAttachment, MindNodePriority, MindNodeTaskStatus } from './document.types'
import type { ThemeId } from './themes'

/**
 * 所有可用命令的联合类型（判别联合）。
 * 详见每条命令的注释。
 */
export type MindMapCommand =
  | { type: 'ADD_CHILD'; parentId: string; topic?: string }
  | { type: 'ADD_SIBLING'; nodeId: string; topic?: string }
  | { type: 'ADD_FREE_TOPIC'; x: number; y: number; topic?: string }
  | { type: 'ATTACH_FREE_TOPIC'; nodeId: string; parentId: string }
  | { type: 'UPDATE_NODE_TOPIC'; nodeId: string; topic: string }
  | { type: 'UPDATE_NODE_NOTE'; nodeId: string; note: string }
  | { type: 'ADD_NODE_LINK'; nodeId: string; url: string; label?: string }
  | { type: 'DELETE_NODE_LINK'; nodeId: string; linkId: string }
  | { type: 'ADD_NODE_ATTACHMENT'; nodeId: string; attachment: MindNodeAttachment }
  | { type: 'DELETE_NODE_ATTACHMENT'; nodeId: string; attachmentId: string }
  | { type: 'SET_NODE_TASK_STATUS'; nodeId: string; taskStatus: MindNodeTaskStatus }
  | { type: 'SET_NODE_PRIORITY'; nodeId: string; priority: MindNodePriority }
  | { type: 'SET_NODE_DUE_DATE'; nodeId: string; dueDate: string | null }
  | { type: 'DELETE_NODE'; nodeId: string }
  | { type: 'CREATE_RELATION'; sourceId: string; targetId: string; label?: string }
  | { type: 'UPDATE_RELATION_LABEL'; relationId: string; label: string }
  | { type: 'DELETE_RELATION'; relationId: string }
  | { type: 'CREATE_BOUNDARY'; nodeIds: string[]; label?: string }
  | { type: 'UPDATE_BOUNDARY_LABEL'; boundaryId: string; label: string }
  | { type: 'DELETE_BOUNDARY'; boundaryId: string }
  | { type: 'TOGGLE_COLLAPSE'; nodeId: string }
  | { type: 'COLLAPSE_DESCENDANTS'; nodeId: string }
  | { type: 'EXPAND_DESCENDANTS'; nodeId: string }
  | { type: 'REVEAL_NODE'; nodeId: string }
  | { type: 'UPDATE_NODE_OFFSET'; nodeId: string; offsetX: number; offsetY: number }
  /** 拖拽根节点时平移整张导图 */
  | { type: 'TRANSLATE_DOCUMENT'; deltaX: number; deltaY: number }
  | { type: 'RESET_NODE_OFFSET'; nodeId: string }
  | { type: 'RESET_LAYOUT' }
  /** 自动排列：保存当前偏移快照 → 清除所有 offset → 让 tree-layout 接管 */
  | { type: 'AUTO_ARRANGE' }
  /** 从快照恢复自由排布 */
  | { type: 'RESTORE_FREEFORM_LAYOUT' }
  | { type: 'MOVE_NODE'; nodeId: string; newParentId: string; index: number }
  | { type: 'INDENT_NODE'; nodeId: string }
  | { type: 'OUTDENT_NODE'; nodeId: string }
  | { type: 'PASTE_SUBTREE'; parentId: string; clipboard: MindNodeClipboard }
  | { type: 'RENAME_DOCUMENT'; title: string }
  | { type: 'SET_CATEGORY'; categoryId: string }
  | { type: 'SAVE_QUICK_NOTE'; title: string; categoryId: string }
  | { type: 'UPDATE_LAYOUT'; layout: Partial<LayoutConfig> }
  | { type: 'APPLY_THEME'; themeId: ThemeId }

export type CommandResult = { document: MindMapDocument; focusNodeId?: string; focusRelationId?: string }

/**
 * 剪贴板数据结构：递归保存一个节点及其完整子树（不含 id，用于粘贴时重新生成）。
 */
export type MindNodeClipboard = {
  topic: string
  note: string
  links: Array<{ url: string; label: string }>
  attachments: MindNodeAttachment[]
  taskStatus: MindNodeTaskStatus
  priority: MindNodePriority
  dueDate: string | null
  collapsed: boolean
  children: MindNodeClipboard[]
}

// 深拷贝文档，保证命令执行是纯函数，不污染原状态。
function copy(document: MindMapDocument): MindMapDocument {
  return structuredClone(document)
}

// 每次状态变更后更新时间戳，供 persistence 层判断"最近修改"文档。
function touch(document: MindMapDocument) {
  document.updatedAt = Date.now()
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * 新增结构后回归树形布局。若此前存在自由拖拽，则只在第一次自动布局时保留快照，
 * 连续创建节点不会把最初的自由排布历史覆盖成一堆零偏移。
 */
function arrangeAfterInsert(document: MindMapDocument) {
  if (!document.layout.freeformOffsets) {
    document.layout.freeformOffsets = Object.fromEntries(
      Object.values(document.nodes).map((node) => [node.id, { x: node.offsetX, y: node.offsetY }]),
    )
  }
  Object.values(document.nodes).filter((node) => !node.isFreeTopic).forEach((node) => { node.offsetX = 0; node.offsetY = 0 })
}

/** 节点离开原同级集合后，边界应收缩；只剩一个节点的边界自动消失。 */
function removeNodeFromBoundaries(document: MindMapDocument, nodeId: string) {
  document.boundaries = document.boundaries.flatMap((boundary) => {
    const nodeIds = boundary.nodeIds.filter((id) => id !== nodeId)
    return nodeIds.length >= 2 ? [{ ...boundary, nodeIds, updatedAt: Date.now() }] : []
  })
}

// 递归删除子树：从叶子节点向上逐层删除，确保不遗漏。
function removeSubtree(document: MindMapDocument, nodeId: string) {
  const node = document.nodes[nodeId]
  node.childIds.forEach((childId) => removeSubtree(document, childId))
  document.relations = document.relations.filter((relation) => relation.sourceId !== nodeId && relation.targetId !== nodeId)
  removeNodeFromBoundaries(document, nodeId)
  delete document.nodes[nodeId]
}

function createRelation(sourceId: string, targetId: string, label: string): MindMapRelation {
  const now = Date.now()
  return { id: crypto.randomUUID(), sourceId, targetId, label: label.trim() || '关联', createdAt: now, updatedAt: now }
}

function createBoundary(parentId: string, nodeIds: string[], label: string): MindMapBoundary {
  const now = Date.now()
  return { id: crypto.randomUUID(), parentId, nodeIds, label: label.trim() || '分组', createdAt: now, updatedAt: now }
}

// 检查 candidateId 是否在 ancestorId 的子树中（含自身），用于防止循环引用。
function isDescendant(document: MindMapDocument, ancestorId: string, candidateId: string): boolean {
  if (ancestorId === candidateId) return true
  return document.nodes[ancestorId].childIds.some((childId) => isDescendant(document, childId, candidateId))
}

/**
 * 移动节点到新父节点下指定位置。
 * 关键约束：
 * - 根节点不可移动
 * - 禁止移动到自身子树中（isDescendant 检查）
 * - 移动后重置新节点的 offset，并展开新父节点
 */
function moveNode(document: MindMapDocument, nodeId: string, newParentId: string, index: number) {
  const node = document.nodes[nodeId]
  const newParent = document.nodes[newParentId]
  if (!node || !newParent) throw new Error('节点不存在')
  if (!node.parentId) throw new Error('根节点不能调整层级')
  if (isDescendant(document, nodeId, newParentId)) throw new Error('节点不能移动到自身子树中')

  const previousParent = document.nodes[node.parentId]
  const previousIndex = previousParent.childIds.indexOf(nodeId)
  previousParent.childIds = previousParent.childIds.filter((id) => id !== nodeId)
  if (previousParent.id !== newParent.id) removeNodeFromBoundaries(document, nodeId)
  // 同一父节点内向下移动时，移除自身会让目标索引左移一格。
  const adjustedIndex = previousParent.id === newParent.id && previousIndex >= 0 && previousIndex < index ? index - 1 : index
  const targetIndex = Math.max(0, Math.min(adjustedIndex, newParent.childIds.length))
  newParent.childIds.splice(targetIndex, 0, nodeId)
  node.parentId = newParentId
  node.offsetX = 0
  node.offsetY = 0
  newParent.collapsed = false
}

/**
 * 将节点及其子树序列化为剪贴板（不含 id，粘贴时重新生成）。
 * 递归保存 topic / collapsed / children，供 PASTE_SUBTREE 使用。
 */
export function createNodeClipboard(document: MindMapDocument, nodeId: string): MindNodeClipboard {
  const node = document.nodes[nodeId]
  if (!node) throw new Error('节点不存在')
  return {
    topic: node.topic,
    note: node.note,
    links: node.links.map(({ url, label }) => ({ url, label })),
    attachments: structuredClone(node.attachments),
    taskStatus: node.taskStatus,
    priority: node.priority,
    dueDate: node.dueDate,
    collapsed: node.collapsed,
    children: node.childIds.map((childId) => createNodeClipboard(document, childId)),
  }
}

// 递归创建子树（为每个节点分配新 id），返回插入的根节点 id。
function pasteSubtree(document: MindMapDocument, parentId: string, clipboard: MindNodeClipboard): string {
  const parent = document.nodes[parentId]
  if (!parent) throw new Error('父节点不存在')
  const node = createNode(clipboard.topic, parentId)
  node.collapsed = clipboard.collapsed
  node.note = clipboard.note
  node.links = clipboard.links.map((link) => ({ ...link, id: crypto.randomUUID() }))
  node.attachments = structuredClone(clipboard.attachments)
  node.taskStatus = clipboard.taskStatus
  node.priority = clipboard.priority
  node.dueDate = clipboard.dueDate
  document.nodes[node.id] = node
  node.childIds = clipboard.children.map((child) => pasteSubtree(document, node.id, child))
  return node.id
}

export function executeCommand(source: MindMapDocument, command: MindMapCommand): CommandResult {
  const document = copy(source)
  let focusNodeId: string | undefined
  let focusRelationId: string | undefined

  switch (command.type) {
    // ── 节点增删 ──────────────────────────────────────────────
    case 'ADD_CHILD': {
      const parent = document.nodes[command.parentId]
      if (!parent) throw new Error('父节点不存在')
      const child = createNode(command.topic ?? '新节点', parent.id)
      parent.childIds.push(child.id)
      // 新增子节点时自动展开父节点，让子节点立即可见。
      parent.collapsed = false
      document.nodes[child.id] = child
      arrangeAfterInsert(document)
      focusNodeId = child.id
      break
    }
    case 'ADD_SIBLING': {
      const node = document.nodes[command.nodeId]
      if (!node?.parentId) throw new Error('根节点不能创建同级节点')
      const parent = document.nodes[node.parentId]
      const sibling = createNode(command.topic ?? '新节点', parent.id)
      // 插入到当前节点之后，保持同级顺序。
      const index = parent.childIds.indexOf(node.id)
      parent.childIds.splice(index + 1, 0, sibling.id)
      document.nodes[sibling.id] = sibling
      arrangeAfterInsert(document)
      focusNodeId = sibling.id
      break
    }
    case 'ADD_FREE_TOPIC': {
      const topic = createNode(command.topic ?? '自由主题', null)
      topic.isFreeTopic = true
      topic.offsetX = Math.round(command.x)
      topic.offsetY = Math.round(command.y)
      document.nodes[topic.id] = topic
      focusNodeId = topic.id
      break
    }
    case 'ATTACH_FREE_TOPIC': {
      const topic = document.nodes[command.nodeId]
      const parent = document.nodes[command.parentId]
      if (!topic?.isFreeTopic || !parent || parent.isFreeTopic) throw new Error('无法吸附自由主题')
      topic.isFreeTopic = false
      topic.parentId = parent.id
      parent.childIds.push(topic.id)
      parent.collapsed = false
      arrangeAfterInsert(document)
      focusNodeId = topic.id
      break
    }
    case 'UPDATE_NODE_TOPIC': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      node.topic = command.topic.trim() || '未命名节点'
      node.updatedAt = Date.now()
      break
    }
    case 'UPDATE_NODE_NOTE': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      node.note = command.note
      node.updatedAt = Date.now()
      break
    }
    case 'ADD_NODE_LINK': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      let url: URL
      try { url = new URL(command.url.trim()) } catch { throw new Error('请输入有效的链接地址') }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('链接仅支持 HTTP 或 HTTPS 地址')
      if (node.links.some((link) => link.url === url.toString())) throw new Error('该链接已添加')
      node.links.push({ id: crypto.randomUUID(), url: url.toString(), label: command.label?.trim() || url.hostname })
      node.updatedAt = Date.now()
      break
    }
    case 'DELETE_NODE_LINK': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      node.links = node.links.filter((link) => link.id !== command.linkId)
      node.updatedAt = Date.now()
      break
    }
    case 'ADD_NODE_ATTACHMENT': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      if (node.attachments.some((attachment) => attachment.id === command.attachment.id)) throw new Error('附件已添加')
      node.attachments.push(command.attachment)
      node.updatedAt = Date.now()
      break
    }
    case 'DELETE_NODE_ATTACHMENT': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      node.attachments = node.attachments.filter((attachment) => attachment.id !== command.attachmentId)
      node.updatedAt = Date.now()
      break
    }
    case 'SET_NODE_TASK_STATUS': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      node.taskStatus = command.taskStatus
      node.updatedAt = Date.now()
      break
    }
    case 'SET_NODE_PRIORITY': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      node.priority = command.priority
      node.updatedAt = Date.now()
      break
    }
    case 'SET_NODE_DUE_DATE': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      const dueDate = command.dueDate?.trim() || null
      if (dueDate && !isValidDate(dueDate)) throw new Error('截止日期格式无效')
      node.dueDate = dueDate
      node.updatedAt = Date.now()
      break
    }
    case 'DELETE_NODE': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      if (!node.parentId && !node.isFreeTopic) throw new Error('根节点不能删除')
      const parent = node.parentId ? document.nodes[node.parentId] : null
      if (parent) parent.childIds = parent.childIds.filter((id) => id !== node.id)
      // 递归删除整个子树，删除后焦点回到被删节点的父节点。
      removeSubtree(document, node.id)
      focusNodeId = parent?.id ?? document.rootId
      break
    }
    case 'CREATE_RELATION': {
      if (!document.nodes[command.sourceId] || !document.nodes[command.targetId]) throw new Error('关系节点不存在')
      if (command.sourceId === command.targetId) throw new Error('关系不能连接节点自身')
      if (document.relations.some((relation) => (relation.sourceId === command.sourceId && relation.targetId === command.targetId)
        || (relation.sourceId === command.targetId && relation.targetId === command.sourceId))) throw new Error('节点之间已存在关系')
      const relation = createRelation(command.sourceId, command.targetId, command.label ?? '关联')
      document.relations.push(relation)
      focusRelationId = relation.id
      break
    }
    case 'UPDATE_RELATION_LABEL': {
      const relation = document.relations.find((item) => item.id === command.relationId)
      if (!relation) throw new Error('关系不存在')
      relation.label = command.label.trim() || '关联'
      relation.updatedAt = Date.now()
      focusRelationId = relation.id
      break
    }
    case 'DELETE_RELATION': {
      const index = document.relations.findIndex((relation) => relation.id === command.relationId)
      if (index < 0) throw new Error('关系不存在')
      document.relations.splice(index, 1)
      break
    }
    case 'CREATE_BOUNDARY': {
      const nodeIds = [...new Set(command.nodeIds)]
      if (nodeIds.length < 2) throw new Error('至少选择两个同级节点才能创建边界')
      const first = document.nodes[nodeIds[0]]
      if (!first?.parentId || first.isFreeTopic) throw new Error('边界不能包含根节点或自由主题')
      if (nodeIds.some((nodeId) => document.nodes[nodeId]?.parentId !== first.parentId || document.nodes[nodeId]?.isFreeTopic)) throw new Error('边界只能包含同级节点')
      document.boundaries.push(createBoundary(first.parentId, nodeIds, command.label ?? '分组'))
      break
    }
    case 'UPDATE_BOUNDARY_LABEL': {
      const boundary = document.boundaries.find((item) => item.id === command.boundaryId)
      if (!boundary) throw new Error('边界不存在')
      boundary.label = command.label.trim() || '分组'
      boundary.updatedAt = Date.now()
      break
    }
    case 'DELETE_BOUNDARY': {
      const index = document.boundaries.findIndex((item) => item.id === command.boundaryId)
      if (index < 0) throw new Error('边界不存在')
      document.boundaries.splice(index, 1)
      break
    }

    // ── 折叠 / 偏移量 ──────────────────────────────────────────
    case 'TOGGLE_COLLAPSE': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      node.collapsed = !node.collapsed
      break
    }
    case 'COLLAPSE_DESCENDANTS': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      const collapse = (nodeId: string) => {
        const current = document.nodes[nodeId]
        current.childIds.forEach((childId) => {
          document.nodes[childId].collapsed = true
          collapse(childId)
        })
      }
      collapse(node.id)
      break
    }
    case 'EXPAND_DESCENDANTS': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      const expand = (nodeId: string) => {
        const current = document.nodes[nodeId]
        current.collapsed = false
        current.childIds.forEach(expand)
      }
      expand(node.id)
      break
    }
    case 'REVEAL_NODE': {
      let node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      while (node.parentId) {
        const parent = document.nodes[node.parentId]
        parent.collapsed = false
        node = parent
      }
      focusNodeId = command.nodeId
      break
    }
    case 'UPDATE_NODE_OFFSET': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      // 偏移量取整，防止浮点积累。
      node.offsetX = Math.round(command.offsetX)
      node.offsetY = Math.round(command.offsetY)
      node.updatedAt = Date.now()
      break
    }
    // 拖拽根节点时平移整张导图，保持相对布局不变。
    case 'TRANSLATE_DOCUMENT':
      Object.values(document.nodes).forEach((node) => {
        node.offsetX = Math.round(node.offsetX + command.deltaX)
        node.offsetY = Math.round(node.offsetY + command.deltaY)
      })
      break
    case 'RESET_NODE_OFFSET': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      node.offsetX = 0
      node.offsetY = 0
      break
    }
    // 清除所有节点的偏移量，回到纯自动布局状态。
    case 'RESET_LAYOUT':
      Object.values(document.nodes).filter((node) => !node.isFreeTopic).forEach((node) => { node.offsetX = 0; node.offsetY = 0 })
      break

    // ── 自动排列 ↔ 自由排布恢复 ────────────────────────────────
    // 保存快照 → 清除 offset → tree-layout 完全接管
    case 'AUTO_ARRANGE':
      document.layout.freeformOffsets = Object.fromEntries(
        Object.values(document.nodes).map((node) => [node.id, { x: node.offsetX, y: node.offsetY }]),
      )
      Object.values(document.nodes).filter((node) => !node.isFreeTopic).forEach((node) => { node.offsetX = 0; node.offsetY = 0 })
      break
    // 从之前保存的快照恢复自由排布偏移。
    case 'RESTORE_FREEFORM_LAYOUT': {
      const offsets = document.layout.freeformOffsets
      if (!offsets) throw new Error('尚未保存自由排布记录')
      Object.values(document.nodes).forEach((node) => {
        const offset = offsets[node.id]
        node.offsetX = offset?.x ?? 0
        node.offsetY = offset?.y ?? 0
      })
      // 已恢复后清空快照；下一次自动排列会重新记录最新的自由排布。
      document.layout.freeformOffsets = null
      break
    }

    // ── 结构调整 ──────────────────────────────────────────────
    // 拖拽节点（非 Shift）时更新该节点的偏移；Shift+拖拽则触发结构移动。
    case 'MOVE_NODE':
      moveNode(document, command.nodeId, command.newParentId, command.index)
      focusNodeId = command.nodeId
      break
    // 降低层级：变成前一同级节点的子节点（向右缩进）。
    case 'INDENT_NODE': {
      const node = document.nodes[command.nodeId]
      if (!node?.parentId) throw new Error('根节点不能降低层级')
      const siblings = document.nodes[node.parentId].childIds
      const index = siblings.indexOf(node.id)
      if (index < 1) throw new Error('第一个同级节点不能降低层级')
      const previousSibling = document.nodes[siblings[index - 1]]
      moveNode(document, node.id, previousSibling.id, previousSibling.childIds.length)
      focusNodeId = node.id
      break
    }
    // 提升层级：移动到父节点之后（向左提升）。
    case 'OUTDENT_NODE': {
      const node = document.nodes[command.nodeId]
      if (!node?.parentId) throw new Error('根节点不能提升层级')
      const parent = document.nodes[node.parentId]
      if (!parent.parentId) throw new Error('一级节点不能提升层级')
      const grandparent = document.nodes[parent.parentId]
      moveNode(document, node.id, grandparent.id, grandparent.childIds.indexOf(parent.id) + 1)
      focusNodeId = node.id
      break
    }
    // 将剪贴板内容递归插入为父节点的子节点（所有节点重新分配 id）。
    case 'PASTE_SUBTREE': {
      const parent = document.nodes[command.parentId]
      if (!parent) throw new Error('父节点不存在')
      const rootId = pasteSubtree(document, parent.id, command.clipboard)
      parent.childIds.push(rootId)
      parent.collapsed = false
      arrangeAfterInsert(document)
      focusNodeId = rootId
      break
    }

    // ── 文档级操作 ───────────────────────────────────────────
    case 'RENAME_DOCUMENT':
      document.title = command.title.trim() || '未命名导图'
      break
    case 'SET_CATEGORY':
      document.categoryId = command.categoryId.trim() || 'uncategorized'
      break
    case 'SAVE_QUICK_NOTE':
      if (!document.isDraft) throw new Error('当前导图不是随手记草稿')
      document.title = command.title.trim() || '未命名导图'
      document.categoryId = command.categoryId.trim() || 'uncategorized'
      document.isDraft = false
      break
    case 'UPDATE_LAYOUT':
      document.layout = { ...document.layout, ...command.layout }
      break
    case 'APPLY_THEME':
      document.theme = { id: command.themeId }
      break
  }

  touch(document)
  assertValidDocument(document)
  return { document, focusNodeId, focusRelationId }
}
