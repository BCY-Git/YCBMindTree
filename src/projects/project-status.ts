import type { DepositBatch, DepositCandidate, DepositProvenance } from '../ai/deposit/deposit-types'
import type { WorkflowSession } from '../ai/workflow/workflow-types'
import type { MindMapDocument, MindNode, MindNodePriority, MindNodeTaskStatus } from '../domain/document.types'

export type ProjectStatusSource = {
  documentId: string
  nodeIds: string[]
  snapshot: string
}

export type ProjectStatusItem = {
  id: string
  title: string
  detail: string
  updatedAt: number
  nodeId: string | null
  taskStatus: MindNodeTaskStatus | null
  priority: MindNodePriority
  source: ProjectStatusSource | null
}

export type ProjectStatus = {
  rootNodeId: string
  goal: string
  progress: { done: number; total: number }
  active: ProjectStatusItem[]
  blockers: ProjectStatusItem[]
  recentResults: ProjectStatusItem[]
  decisions: ProjectStatusItem[]
  nextActions: ProjectStatusItem[]
  provenanceCount: number
}

type ProjectStatusInput = {
  document: MindMapDocument
  rootNodeId: string
  batches: DepositBatch[]
  provenance: DepositProvenance[]
  workflowSessions?: WorkflowSession[]
}

function subtreeIds(document: MindMapDocument, rootNodeId: string) {
  const ids = new Set<string>()
  const visit = (nodeId: string) => {
    if (ids.has(nodeId)) return
    const node = document.nodes[nodeId]
    if (!node) return
    ids.add(nodeId)
    node.childIds.forEach(visit)
  }
  visit(rootNodeId)
  return ids
}

function nodeItem(node: MindNode): ProjectStatusItem {
  return { id: `node:${node.id}`, title: node.topic || '未命名主题', detail: node.note, updatedAt: node.updatedAt, nodeId: node.id, taskStatus: node.taskStatus, priority: node.priority, source: null }
}

function candidateItem(candidate: DepositCandidate, record: DepositProvenance): ProjectStatusItem {
  return {
    id: `candidate:${record.id}`,
    title: candidate.title,
    detail: candidate.detail,
    updatedAt: record.createdAt,
    nodeId: record.targetNodeIds[0] ?? null,
    taskStatus: null,
    priority: 0,
    source: { documentId: record.sourceDocumentId, nodeIds: record.sourceNodeIds, snapshot: record.sourceSnapshot },
  }
}

function nextActionItem(session: WorkflowSession, action: string): ProjectStatusItem {
  return { id: `workflow:${session.id}:${action}`, title: action, detail: '来自智能协作检查点', updatedAt: session.updatedAt, nodeId: session.focusNodeId, taskStatus: null, priority: 0, source: null }
}

function uniqueItems(items: ProjectStatusItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const fingerprint = `${item.nodeId ?? ''}:${item.title.trim().toLocaleLowerCase()}`
    if (seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  })
}

function sortRecent(left: ProjectStatusItem, right: ProjectStatusItem) {
  return right.updatedAt - left.updatedAt || left.title.localeCompare(right.title, 'zh-CN')
}

function sortTasks(left: ProjectStatusItem, right: ProjectStatusItem) {
  const statusOrder: Record<NonNullable<ProjectStatusItem['taskStatus']>, number> = { doing: 0, todo: 1, done: 2, none: 3 }
  return statusOrder[left.taskStatus ?? 'none'] - statusOrder[right.taskStatus ?? 'none']
    || (left.priority || 9) - (right.priority || 9)
    || sortRecent(left, right)
}

/**
 * 从项目分支、已经确认的沉淀和协作检查点派生状态；不保存、不修改原始记录。
 * 这让日报保持时间语境，项目树则成为可持续推进的工作视图。
 */
export function buildProjectStatus({ document, rootNodeId, batches, provenance, workflowSessions = [] }: ProjectStatusInput): ProjectStatus {
  const root = document.nodes[rootNodeId]
  if (!root) throw new Error('项目节点不存在')
  const scopeIds = subtreeIds(document, rootNodeId)
  const scopeNodes = [...scopeIds].map((id) => document.nodes[id]).filter((node): node is MindNode => Boolean(node))
  const taskNodes = scopeNodes.filter((node) => node.taskStatus !== 'none')
  const active = taskNodes.filter((node) => node.taskStatus === 'todo' || node.taskStatus === 'doing').map(nodeItem).sort(sortTasks)
  const completed = taskNodes.filter((node) => node.taskStatus === 'done').map(nodeItem).sort(sortRecent)
  const risks = scopeNodes.filter((node) => node.marks.includes('risk')).map(nodeItem).sort(sortRecent)

  const batchById = new Map(batches.map((batch) => [batch.id, batch]))
  const records = provenance.filter((record) => record.targetDocumentId === document.id && record.targetNodeIds.some((nodeId) => scopeIds.has(nodeId)))
  const confirmed = records.flatMap((record) => {
    const candidate = batchById.get(record.batchId)?.candidates.find((item) => item.id === record.candidateId)
    return candidate?.status === 'applied' ? [{ candidate, record }] : []
  })

  const deposited = (type: 'result' | 'problem' | 'decision') => confirmed
    .filter(({ candidate }) => candidate.type === type)
    .map(({ candidate, record }) => candidateItem(candidate, record))
    .sort(sortRecent)

  const workflowNext = workflowSessions
    .filter((session) => session.documentId === document.id && scopeIds.has(session.focusNodeId) && session.status === 'active')
    .flatMap((session) => session.nextActions.map((action) => nextActionItem(session, action)))
    .sort(sortRecent)

  const nextActions = uniqueItems([...active, ...workflowNext]).sort(sortTasks)
  return {
    rootNodeId,
    goal: root.topic || '未命名项目',
    progress: { done: taskNodes.filter((node) => node.taskStatus === 'done').length, total: taskNodes.length },
    active: uniqueItems(active),
    blockers: uniqueItems([...risks, ...deposited('problem')]).sort(sortRecent),
    recentResults: uniqueItems([...completed, ...deposited('result')]).sort(sortRecent),
    decisions: uniqueItems(deposited('decision')).sort(sortRecent),
    nextActions,
    provenanceCount: records.length,
  }
}
