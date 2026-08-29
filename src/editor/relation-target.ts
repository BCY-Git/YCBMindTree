import type { MindMapDocument } from '@/domain/document.types'

export type RelationTargetPlan =
  | { status: 'blocked'; reason: string }
  | { status: 'ready'; sourceIds: string[]; skippedExisting: number; skippedSelf: number }

function hasRelation(document: MindMapDocument, sourceId: string, targetId: string, ignoreRelationId?: string) {
  return document.relations.some((relation) =>
    relation.id !== ignoreRelationId && ((relation.sourceId === sourceId && relation.targetId === targetId)
    || (relation.sourceId === targetId && relation.targetId === sourceId)))
}

/**
 * 将关系目标校验集中在一个可测试的入口。
 * 多选来源允许跳过目标自身和已经关联的节点，而不是让整批操作静默失败。
 */
export function planRelationTarget(document: MindMapDocument, candidateSourceIds: string[], targetId: string, ignoreRelationId?: string): RelationTargetPlan {
  if (!document.nodes[targetId]) return { status: 'blocked', reason: '关系目标节点不存在' }
  const sourceIds = [...new Set(candidateSourceIds)].filter((sourceId) => Boolean(document.nodes[sourceId]))
  if (!sourceIds.length) return { status: 'blocked', reason: '关系来源节点不存在' }

  const skippedSelf = sourceIds.filter((sourceId) => sourceId === targetId).length
  const nonSelf = sourceIds.filter((sourceId) => sourceId !== targetId)
  const skippedExisting = nonSelf.filter((sourceId) => hasRelation(document, sourceId, targetId, ignoreRelationId)).length
  const validSourceIds = nonSelf.filter((sourceId) => !hasRelation(document, sourceId, targetId, ignoreRelationId))

  if (validSourceIds.length) return { status: 'ready', sourceIds: validSourceIds, skippedExisting, skippedSelf }
  if (skippedExisting) return { status: 'blocked', reason: '节点之间已存在关系' }
  return { status: 'blocked', reason: '关系不能连接节点自身' }
}
