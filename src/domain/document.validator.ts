/**
 * 文档校验器 — 在每次命令执行后运行，确保导图结构始终合法。
 *
 * 检查项（任一失败均抛出错误）：
 * 1. 根节点存在且 parentId 为 null
 * 2. 从根出发 DFS 遍历，整棵树上无循环（seen set 防重）
 * 3. 每个节点的 childId 在 nodes 中有对应节点
 * 4. 每条父子引用互相一致（子节点的 parentId 指向父节点）
 * 5. 遍历结束后 seen 数量等于 nodes 总数，无孤立节点
 *
 * 此函数是领域的最后一道安全网，任何命令执行后调用，
 * 确保状态机不会落入非法状态。
 */
import type { MindMapDocument } from './document.types'

export function assertValidDocument(document: MindMapDocument): void {
  const root = document.nodes[document.rootId]
  if (!root || root.parentId !== null || root.isFreeTopic) throw new Error('文档根节点无效')

  const freeTopics = Object.values(document.nodes).filter((node) => node.isFreeTopic)
  for (const topic of freeTopics) {
    if (topic.parentId !== null || topic.childIds.length) throw new Error('自由主题不能包含父子树关系')
  }

  const seen = new Set<string>()
  // DFS 遍历：从根出发，依次访问每个子节点。
  const visit = (id: string) => {
    if (seen.has(id)) throw new Error('文档存在循环引用')
    const node = document.nodes[id]
    if (!node) throw new Error(`节点 ${id} 不存在`)
    seen.add(id)
    for (const childId of node.childIds) {
      const child = document.nodes[childId]
      // 父子引用必须互相一致，防止单向孤岛。
      if (!child || child.parentId !== id) throw new Error('父子节点引用不一致')
      visit(childId)
    }
  }
  visit(document.rootId)
  // 确保没有节点游离于遍历之外（即没有孤岛）。
  if (seen.size !== Object.keys(document.nodes).length - freeTopics.length) throw new Error('文档存在孤立节点')

  const relationPairs = new Set<string>()
  for (const relation of document.relations) {
    if (!document.nodes[relation.sourceId] || !document.nodes[relation.targetId]) throw new Error('关系引用了不存在的节点')
    if (relation.sourceId === relation.targetId) throw new Error('关系不能连接节点自身')
    const pair = [relation.sourceId, relation.targetId].sort().join(':')
    if (relationPairs.has(pair)) throw new Error('节点之间已存在关系')
    relationPairs.add(pair)
  }

  for (const boundary of document.boundaries) {
    const parent = document.nodes[boundary.parentId]
    if (!parent || parent.isFreeTopic || boundary.nodeIds.length < 2) throw new Error('边界父节点无效')
    const ids = new Set(boundary.nodeIds)
    if (ids.size !== boundary.nodeIds.length) throw new Error('边界节点重复')
    if (boundary.nodeIds.some((nodeId) => document.nodes[nodeId]?.parentId !== boundary.parentId)) throw new Error('边界只能包含同级节点')
  }

  for (const summary of document.summaries) {
    const parent = document.nodes[summary.parentId]
    if (!parent || parent.isFreeTopic || summary.nodeIds.length < 2) throw new Error('摘要父节点无效')
    const ids = new Set(summary.nodeIds)
    if (ids.size !== summary.nodeIds.length) throw new Error('摘要节点重复')
    if (summary.nodeIds.some((nodeId) => document.nodes[nodeId]?.parentId !== summary.parentId)) throw new Error('摘要只能包含同级节点')
  }
}
