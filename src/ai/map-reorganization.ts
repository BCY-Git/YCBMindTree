import type { MindMapDocument } from '@/domain/document.types'

export type ReorganizationMove = { nodeId: string; newParentId: string; index: number }
export type MapReorganization = { summary: string; moves: ReorganizationMove[] }

function withoutCodeFence(content: string) {
  return content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

/**
 * 只接受文档中真实存在的普通节点，并提前验证最终父级链没有环。
 * 这层校验与 command executor 的运行时校验叠加，确保模型输出不会破坏树。
 */
export function parseMapReorganization(content: string, document: MindMapDocument): MapReorganization {
  const parsed = JSON.parse(withoutCodeFence(content)) as { summary?: unknown; moves?: unknown }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.moves)) throw new Error('AI 返回的整理方案格式无效')
  if (parsed.moves.length > 24) throw new Error('一次最多调整 24 个节点')
  const seen = new Set<string>()
  const moves = parsed.moves.map((value): ReorganizationMove => {
    if (!value || typeof value !== 'object') throw new Error('AI 返回的整理项无效')
    const candidate = value as { nodeId?: unknown; newParentId?: unknown; index?: unknown }
    if (typeof candidate.nodeId !== 'string' || typeof candidate.newParentId !== 'string') throw new Error('整理项缺少节点 ID')
    if (seen.has(candidate.nodeId)) throw new Error('整理方案重复调整同一个节点')
    seen.add(candidate.nodeId)
    const node = document.nodes[candidate.nodeId]
    const parent = document.nodes[candidate.newParentId]
    if (!node || !parent) throw new Error('整理方案引用了不存在的节点')
    if (!node.parentId || node.isFreeTopic || parent.isFreeTopic || node.id === parent.id) throw new Error('整理方案包含不可调整的节点')
    const index = candidate.index === undefined ? parent.childIds.length : candidate.index
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw new Error('整理方案中的顺序无效')
    return { nodeId: node.id, newParentId: parent.id, index }
  })

  const intendedParent = new Map(Object.values(document.nodes).map((node) => [node.id, node.parentId]))
  moves.forEach((move) => intendedParent.set(move.nodeId, move.newParentId))
  moves.forEach((move) => {
    const visited = new Set<string>()
    let current: string | null | undefined = move.nodeId
    while (current) {
      if (visited.has(current)) throw new Error('整理方案会形成循环层级')
      visited.add(current)
      current = intendedParent.get(current)
    }
  })

  return { summary: typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 220) : 'AI 建议调整导图层级与顺序。', moves }
}
