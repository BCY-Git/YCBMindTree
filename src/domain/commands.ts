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
import type { LayoutConfig, MindMapBoundary, MindMapDocument, MindMapRelation, MindMapSummary, MindNodeAttachment, MindNodePriority, MindNodeTaskStatus, NodeMark } from './document.types'
import type { ThemeId } from './themes'

/**
 * 所有可用命令的联合类型（判别联合）。
 * 详见每条命令的注释。
 */
export type MindMapCommand =
  | { type: 'ADD_CHILD'; parentId: string; topic?: string }
  | { type: 'ADD_SIBLING'; nodeId: string; topic?: string }
  | { type: 'ADD_FREE_TOPIC'; x: number; y: number; topic?: string }
  | { type: 'DETACH_AS_FREE_TOPIC'; nodeId: string; x: number; y: number }
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
  | { type: 'TOGGLE_NODE_MARK'; nodeId: string; mark: NodeMark }
  | { type: 'SET_NODE_TAGS'; nodeId: string; tagIds: string[] }
  | { type: 'DELETE_NODE'; nodeId: string }
  | { type: 'DELETE_NODES'; nodeIds: string[] }
  | { type: 'CREATE_RELATION'; sourceId: string; targetId: string; label?: string }
  | { type: 'CREATE_RELATIONS'; sourceIds: string[]; targetId: string; label?: string }
  /** 一次创建共享自由主题与多条关联线，避免生成多个外观相同但实际独立的目标。 */
  | { type: 'CREATE_RELATED_FREE_TOPIC'; sourceIds: string[]; x: number; y: number; topic?: string; label?: string }
  | { type: 'RETARGET_RELATION'; relationId: string; targetId: string }
  | { type: 'UPDATE_RELATION_LABEL'; relationId: string; label: string }
  | { type: 'DELETE_RELATION'; relationId: string }
  | { type: 'CREATE_BOUNDARY'; nodeIds: string[]; label?: string }
  | { type: 'UPDATE_BOUNDARY_LABEL'; boundaryId: string; label: string }
  | { type: 'DELETE_BOUNDARY'; boundaryId: string }
  | { type: 'CREATE_SUMMARY'; nodeIds: string[]; topic?: string }
  | { type: 'UPDATE_SUMMARY_TOPIC'; summaryId: string; topic: string }
  | { type: 'DELETE_SUMMARY'; summaryId: string }
  | { type: 'TOGGLE_COLLAPSE'; nodeId: string }
  | { type: 'COLLAPSE_DESCENDANTS'; nodeId: string }
  | { type: 'EXPAND_DESCENDANTS'; nodeId: string }
  | { type: 'REVEAL_NODE'; nodeId: string }
  | { type: 'UPDATE_NODE_OFFSET'; nodeId: string; offsetX: number; offsetY: number }
  | { type: 'SET_NODE_SIZE'; nodeId: string; width: number; height: number }
  /** 拖拽根节点时平移整张导图 */
  | { type: 'TRANSLATE_DOCUMENT'; deltaX: number; deltaY: number }
  | { type: 'RESET_NODE_OFFSET'; nodeId: string }
  | { type: 'RESET_LAYOUT' }
  /** 自动排列：保存当前偏移快照 → 清除所有 offset → 让 tree-layout 接管 */
  | { type: 'AUTO_ARRANGE' }
  /** 从快照恢复自由排布 */
  | { type: 'RESTORE_FREEFORM_LAYOUT' }
  | { type: 'MOVE_NODE'; nodeId: string; newParentId: string; index: number }
  /** AI 全图整理：在一次可撤销操作内批量调整节点归属与顺序。 */
  | { type: 'REORGANIZE_NODES'; moves: Array<{ nodeId: string; newParentId: string; index: number }> }
  | { type: 'INDENT_NODE'; nodeId: string }
  | { type: 'OUTDENT_NODE'; nodeId: string }
  | { type: 'PASTE_SUBTREE'; parentId: string; clipboard: MindNodeClipboard }
  /** 智能沉淀：在同一份导图内原子应用经用户确认的候选。 */
  | { type: 'APPLY_DEPOSIT_OPERATIONS'; batchId: string; operations: LocalDepositOperation[] }
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
  marks: NodeMark[]
  tagIds: string[]
  collapsed: boolean
  children: MindNodeClipboard[]
}

/** 领域层可执行的智能沉淀写入操作；AI 层只能生成这个受限集合。 */
export type LocalDepositOperation =
  | { type: 'CREATE_BRANCH'; parentId: string; branch: MindNodeClipboard }
  | { type: 'UPDATE_NODE'; nodeId: string; patch: { topic?: string; note?: string } }
  | { type: 'COMPLETE_TASK'; nodeId: string; evidence: string }
  | { type: 'APPEND_NODE_NOTE'; nodeId: string; content: string }

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

function removeNodeFromSummaries(document: MindMapDocument, nodeId: string) {
  document.summaries = document.summaries.flatMap((summary) => {
    const nodeIds = summary.nodeIds.filter((id) => id !== nodeId)
    return nodeIds.length >= 2 ? [{ ...summary, nodeIds, updatedAt: Date.now() }] : []
  })
}

// 递归删除子树：从叶子节点向上逐层删除，确保不遗漏。
function removeSubtree(document: MindMapDocument, nodeId: string) {
  const node = document.nodes[nodeId]
  node.childIds.forEach((childId) => removeSubtree(document, childId))
  document.relations = document.relations.filter((relation) => relation.sourceId !== nodeId && relation.targetId !== nodeId)
  removeNodeFromBoundaries(document, nodeId)
  removeNodeFromSummaries(document, nodeId)
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

function createSummary(parentId: string, nodeIds: string[], topic: string): MindMapSummary {
  const now = Date.now()
  return { id: crypto.randomUUID(), parentId, nodeIds, topic: topic.trim() || '总结', createdAt: now, updatedAt: now }
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
  if (previousParent.id !== newParent.id) {
    removeNodeFromBoundaries(document, nodeId)
    removeNodeFromSummaries(document, nodeId)
  }
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
 * 分批移动时优先执行「当前不会落入自身子树」的移动。
 * 这样 AI 可以同时给出“先把子节点提出来，再调整父节点”的最终结构，而不受 JSON 顺序影响。
 */
function reorganizeNodes(document: MindMapDocument, moves: Array<{ nodeId: string; newParentId: string; index: number }>) {
  const uniqueMoves = [...new Map(moves.map((move) => [move.nodeId, move])).values()]
  if (!uniqueMoves.length) throw new Error('没有可应用的整理建议')
  uniqueMoves.forEach((move) => {
    const node = document.nodes[move.nodeId]
    const parent = document.nodes[move.newParentId]
    if (!node || !parent) throw new Error('整理建议引用了不存在的节点')
    if (!node.parentId || node.isFreeTopic || parent.isFreeTopic) throw new Error('整理建议不能调整根节点或自由主题')
    if (!Number.isInteger(move.index) || move.index < 0) throw new Error('整理建议中的顺序无效')
  })

  // 先对「最终父级」做一次环检测，拒绝看似合理但最终会形成循环的模型输出。
  const intendedParent = new Map(Object.values(document.nodes).map((node) => [node.id, node.parentId]))
  uniqueMoves.forEach((move) => intendedParent.set(move.nodeId, move.newParentId))
  uniqueMoves.forEach((move) => {
    const visited = new Set<string>()
    let current: string | null | undefined = move.nodeId
    while (current) {
      if (visited.has(current)) throw new Error('整理建议会形成循环层级')
      visited.add(current)
      current = intendedParent.get(current)
    }
  })

  const pending = [...uniqueMoves]
  while (pending.length) {
    const readyIndex = pending.findIndex((move) => !isDescendant(document, move.nodeId, move.newParentId))
    if (readyIndex < 0) throw new Error('整理建议无法安全应用')
    const [move] = pending.splice(readyIndex, 1)
    moveNode(document, move.nodeId, move.newParentId, move.index)
  }
  arrangeAfterInsert(document)
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
    marks: [...node.marks],
    tagIds: [...node.tagIds],
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
  node.marks = [...clipboard.marks]
  node.tagIds = [...clipboard.tagIds]
  document.nodes[node.id] = node
  node.childIds = clipboard.children.map((child) => pasteSubtree(document, node.id, child))
  return node.id
}

function appendNodeNote(node: { note: string; updatedAt: number }, content: string) {
  const value = content.trim()
  if (!value) return
  node.note = [node.note.trim(), value].filter(Boolean).join('\n\n')
  node.updatedAt = Date.now()
}

/**
 * 在 copy(document) 上顺序执行，因此任一操作抛错时原始导图完全不受影响。
 * 这里不接受移动、删除或重组，确保智能沉淀只会新增/更新经确认的信息。
 */
function applyDepositOperations(document: MindMapDocument, operations: LocalDepositOperation[]) {
  if (!operations.length) throw new Error('没有可应用的沉淀操作')
  let focusNodeId: string | undefined
  let inserted = false
  for (const operation of operations) {
    if (operation.type === 'CREATE_BRANCH') {
      const parent = document.nodes[operation.parentId]
      if (!parent || parent.isFreeTopic) throw new Error('沉淀目标父节点不存在或不可用')
      const nodeId = pasteSubtree(document, parent.id, operation.branch)
      parent.childIds.push(nodeId)
      parent.collapsed = false
      focusNodeId = nodeId
      inserted = true
      continue
    }
    const node = document.nodes[operation.nodeId]
    if (!node) throw new Error('沉淀目标节点不存在')
    if (operation.type === 'UPDATE_NODE') {
      if (operation.patch.topic !== undefined) node.topic = operation.patch.topic.trim() || '未命名节点'
      if (operation.patch.note !== undefined) node.note = operation.patch.note
      node.updatedAt = Date.now()
    } else if (operation.type === 'COMPLETE_TASK') {
      node.taskStatus = 'done'
      appendNodeNote(node, operation.evidence)
    } else {
      appendNodeNote(node, operation.content)
    }
    focusNodeId = node.id
  }
  if (inserted) arrangeAfterInsert(document)
  return focusNodeId
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
      if (node.isFreeTopic) throw new Error('自由主题不能创建同级节点')
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
    case 'DETACH_AS_FREE_TOPIC': {
      const topic = document.nodes[command.nodeId]
      if (!topic?.parentId) throw new Error('根节点不能转为自由主题')
      const parent = document.nodes[topic.parentId]
      parent.childIds = parent.childIds.filter((id) => id !== topic.id)
      removeNodeFromBoundaries(document, topic.id)
      removeNodeFromSummaries(document, topic.id)
      topic.parentId = null
      topic.isFreeTopic = true
      topic.offsetX = Math.round(command.x)
      topic.offsetY = Math.round(command.y)
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
      if (!['http:', 'https:', 'mindtree:'].includes(url.protocol)) throw new Error('链接仅支持 HTTP、HTTPS 或 MindTree 节点地址')
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
    case 'TOGGLE_NODE_MARK': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      const marks = new Set(node.marks)
      if (marks.has(command.mark)) marks.delete(command.mark)
      else marks.add(command.mark)
      const order: NodeMark[] = ['flag', 'star', 'risk', 'idea']
      node.marks = order.filter((mark) => marks.has(mark))
      node.updatedAt = Date.now()
      break
    }
    case 'SET_NODE_TAGS': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      node.tagIds = [...new Set(command.tagIds.map((id) => id.trim()).filter(Boolean))]
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
    case 'DELETE_NODES': {
      const selected = [...new Set(command.nodeIds)].filter((id) => id !== document.rootId && Boolean(document.nodes[id]))
      if (!selected.length) throw new Error('没有可删除的节点')
      const selectedSet = new Set(selected)
      const topLevel = selected.filter((nodeId) => {
        let current = document.nodes[nodeId]
        while (current?.parentId) {
          if (selectedSet.has(current.parentId)) return false
          current = document.nodes[current.parentId]
        }
        return true
      })
      let nextFocus = document.rootId
      topLevel.forEach((nodeId) => {
        const node = document.nodes[nodeId]
        const parent = node?.parentId ? document.nodes[node.parentId] : null
        if (parent) {
          parent.childIds = parent.childIds.filter((id) => id !== nodeId)
          nextFocus = parent.id
        }
        removeSubtree(document, nodeId)
      })
      focusNodeId = nextFocus
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
    case 'CREATE_RELATIONS': {
      const sourceIds = [...new Set(command.sourceIds)]
      if (!sourceIds.length || !document.nodes[command.targetId] || sourceIds.some((sourceId) => !document.nodes[sourceId])) throw new Error('关系节点不存在')
      sourceIds.forEach((sourceId) => {
        if (sourceId === command.targetId) throw new Error('关系不能连接节点自身')
        if (document.relations.some((relation) => (relation.sourceId === sourceId && relation.targetId === command.targetId)
          || (relation.sourceId === command.targetId && relation.targetId === sourceId))) throw new Error('节点之间已存在关系')
      })
      const relations = sourceIds.map((sourceId) => createRelation(sourceId, command.targetId, command.label ?? '关联'))
      document.relations.push(...relations)
      focusRelationId = relations.at(-1)?.id
      break
    }
    case 'CREATE_RELATED_FREE_TOPIC': {
      const sourceIds = [...new Set(command.sourceIds)]
      if (!sourceIds.length || sourceIds.some((sourceId) => !document.nodes[sourceId])) throw new Error('关系节点不存在')
      const target = createNode(command.topic ?? '新主题', null)
      target.isFreeTopic = true
      target.offsetX = Math.round(command.x)
      target.offsetY = Math.round(command.y)
      document.nodes[target.id] = target
      const relations = sourceIds.map((sourceId) => createRelation(sourceId, target.id, command.label ?? '关联'))
      document.relations.push(...relations)
      focusNodeId = target.id
      break
    }
    case 'RETARGET_RELATION': {
      const relation = document.relations.find((item) => item.id === command.relationId)
      if (!relation) throw new Error('关系不存在')
      if (!document.nodes[command.targetId]) throw new Error('关系节点不存在')
      if (command.targetId === relation.sourceId) throw new Error('关系不能连接节点自身')
      if (document.relations.some((item) => item.id !== relation.id && ((item.sourceId === relation.sourceId && item.targetId === command.targetId)
        || (item.sourceId === command.targetId && item.targetId === relation.sourceId)))) throw new Error('节点之间已存在关系')
      relation.targetId = command.targetId
      relation.updatedAt = Date.now()
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
    case 'CREATE_SUMMARY': {
      const nodeIds = [...new Set(command.nodeIds)]
      if (nodeIds.length < 2) throw new Error('至少选择两个同级节点才能创建摘要')
      const first = document.nodes[nodeIds[0]]
      if (!first?.parentId || first.isFreeTopic) throw new Error('摘要不能包含根节点或自由主题')
      if (nodeIds.some((nodeId) => document.nodes[nodeId]?.parentId !== first.parentId || document.nodes[nodeId]?.isFreeTopic)) throw new Error('摘要只能包含同级节点')
      document.summaries.push(createSummary(first.parentId, nodeIds, command.topic ?? '总结'))
      break
    }
    case 'UPDATE_SUMMARY_TOPIC': {
      const summary = document.summaries.find((item) => item.id === command.summaryId)
      if (!summary) throw new Error('摘要不存在')
      summary.topic = command.topic.trim() || '总结'
      summary.updatedAt = Date.now()
      break
    }
    case 'DELETE_SUMMARY': {
      const index = document.summaries.findIndex((item) => item.id === command.summaryId)
      if (index < 0) throw new Error('摘要不存在')
      document.summaries.splice(index, 1)
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
    case 'SET_NODE_SIZE': {
      const node = document.nodes[command.nodeId]
      if (!node) throw new Error('节点不存在')
      const minWidth = node.id === document.rootId ? 196 : 118
      const minHeight = node.id === document.rootId ? 58 : 44
      if (!Number.isFinite(command.width) || !Number.isFinite(command.height)
        || command.width < minWidth || command.width > 560 || command.height < minHeight || command.height > 420) throw new Error('节点尺寸无效')
      node.width = Math.round(command.width)
      node.height = Math.round(command.height)
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
    // 结构变化后统一回到树形布局，避免历史自由偏移造成跨层或回连。
    case 'MOVE_NODE':
      moveNode(document, command.nodeId, command.newParentId, command.index)
      arrangeAfterInsert(document)
      focusNodeId = command.nodeId
      break
    case 'REORGANIZE_NODES':
      reorganizeNodes(document, command.moves)
      focusNodeId = command.moves[0]?.nodeId
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
      arrangeAfterInsert(document)
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
      arrangeAfterInsert(document)
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
    case 'APPLY_DEPOSIT_OPERATIONS':
      focusNodeId = applyDepositOperations(document, command.operations)
      break

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
