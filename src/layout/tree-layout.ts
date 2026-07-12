/**
 * 右向递归树布局算法。
 *
 * 将 MindMapDocument 中的节点字典转换为带绝对坐标的 PositionedNode 数组，
 * 用于交给 @xyflow/react 渲染。所有节点按从根到叶的深度顺序依次放置，
 * 每层子节点在该层的垂直区间内均匀展开，子节点始终在父节点右侧（levelGap）。
 *
 * 核心思路（两遍递归）：
 * 1. measure() 自底向上：计算每棵子树需要的总高度（考虑折叠节点）
 * 2. place() 自顶向下：结合 subtree 高度，将节点垂直居中于其子树区间
 *
 * 折叠节点不参与 measure/plac e，直接跳过其子树的布局。
 * 每个节点的位置最终叠加 node.offsetX/Y，以支持用户手动微调。
 */
import type { MindMapDocument, MindNode } from '../domain/document.types'

export type PositionedNode = { id: string; x: number; y: number; width: number; height: number }

// 节点宽高常量（px）。宽度根据主题文本长度动态计算（见 nodeSize 函数）。
const ROOT_WIDTH = 196
const NODE_WIDTH = 176
const NODE_HEIGHT = 44
const ROOT_HEIGHT = 58
const TEXT_CHARACTER_WIDTH = 11
const HORIZONTAL_TEXT_PADDING = 44

/**
 * 根据节点主题文本计算渲染尺寸。
 * - 宽度：按中英文混合文本宽度估算，受 min/max 约束
 * - 高度：根节点 58px，子节点 44px，每多一行文字 +20px
 */
function nodeSize(node: MindNode, isRoot: boolean, transientHeight?: number) {
  const longestLine = Math.max(...node.topic.split('\n').map((line) => line.length), 1)
  const automaticWidth = Math.min(isRoot ? 260 : NODE_WIDTH + 36, Math.max(isRoot ? ROOT_WIDTH : 118, longestLine * TEXT_CHARACTER_WIDTH + HORIZONTAL_TEXT_PADDING))
  const width = Math.max(isRoot ? ROOT_WIDTH : 118, node.width ?? automaticWidth)
  const charactersPerLine = Math.max(8, Math.floor((width - HORIZONTAL_TEXT_PADDING) / TEXT_CHARACTER_WIDTH))
  const lines = Math.max(1, node.topic.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0))
  const automaticHeight = (isRoot ? ROOT_HEIGHT : NODE_HEIGHT) + (lines - 1) * 20
  return { width, height: Math.max(node.height ?? 0, automaticHeight, transientHeight ?? 0) }
}

/**
 * `transientHeights` 只服务于编辑中的节点（例如 AI 幽灵续写临时撑高卡片）。
 * 它不写入文档，也不会污染撤销历史；结束编辑后布局自然回到持久化尺寸。
 */
export function layoutTree(document: MindMapDocument, transientHeights?: ReadonlyMap<string, number>): PositionedNode[] {
  // ── 第一遍：自底向上计算每棵子树的所需高度 ─────────────────────────
  // 折叠节点不展开其子节点，等同于叶子节点处理。
  const heights = new Map<string, number>()
  const measure = (id: string): number => {
    const node = document.nodes[id]
    const ownHeight = nodeSize(node, id === document.rootId, transientHeights?.get(id)).height
    const children = node.collapsed ? [] : node.childIds
    // 子树总高度 = 所有子节点高度 + (子节点数 - 1) × 同级间距
    const childrenHeight = children.reduce((sum, childId) => sum + measure(childId), 0)
      + Math.max(0, children.length - 1) * document.layout.siblingGap
    const height = Math.max(ownHeight, childrenHeight)
    heights.set(id, height)
    return height
  }

  // ── 第二遍：自顶向下放置节点 ───────────────────────────────────────
  // place() 接收当前节点的目标矩形（x, top），在内部计算 y 坐标（垂直居中）。
  const output: PositionedNode[] = []
  const place = (id: string, x: number, top: number) => {
    const node = document.nodes[id]
    const { width, height } = nodeSize(node, id === document.rootId, transientHeights?.get(id))
    const subtreeHeight = heights.get(id) ?? height
    // 节点 y = 子树顶 + (子树高度 - 节点自身高度) / 2 → 垂直居中
    const y = top + (subtreeHeight - height) / 2
    // 叠加节点的自由偏移量，支持用户手动拖拽微调。
    output.push({ id, x: x + node.offsetX, y: y + node.offsetY, width, height })
    if (node.collapsed) return
    const children = node.childIds
    // 根主题只有一条展开分支时，其余一级叶子并不需要为那条分支的全部后代让位。
    // 将一级节点按自身卡片高度紧凑排列，既减少大片空白，又不会与其他分支的后代相撞。
    const expandedBranchCount = id === document.rootId
      ? children.filter((childId) => {
        const child = document.nodes[childId]
        return !child.collapsed && child.childIds.length > 0
      }).length
      : 0
    if (id === document.rootId && expandedBranchCount <= 1) {
      const directChildrenHeight = children.reduce((sum, childId) => sum + nodeSize(document.nodes[childId], false, transientHeights?.get(childId)).height, 0)
        + Math.max(0, children.length - 1) * document.layout.siblingGap
      let cardTop = y + height / 2 - directChildrenHeight / 2
      children.forEach((childId) => {
        const childHeight = nodeSize(document.nodes[childId], false, transientHeights?.get(childId)).height
        const childSubtreeHeight = heights.get(childId) ?? childHeight
        // place() 会把节点卡片放在 childTop + (subtreeHeight - ownHeight) / 2，
        // 因此反推 childTop，保证卡片正好落在紧凑的 cardTop 上。
        place(childId, x + width + document.layout.levelGap, cardTop - (childSubtreeHeight - childHeight) / 2)
        cardTop += childHeight + document.layout.siblingGap
      })
      return
    }
    // 计算所有子节点的子树总高度（含间距），用于垂直居中。
    const childrenHeight = children.reduce((sum, childId) => sum + (heights.get(childId) ?? 0), 0)
      + Math.max(0, children.length - 1) * document.layout.siblingGap
    let childTop = top + (subtreeHeight - childrenHeight) / 2
    children.forEach((childId) => {
      // 每向下一层，x 增加 levelGap（向右推移一个层级）。
      place(childId, x + width + document.layout.levelGap, childTop)
      childTop += (heights.get(childId) ?? 0) + document.layout.siblingGap
    })
  }

  measure(document.rootId)
  place(document.rootId, 0, 0)
  // 自由主题不属于根节点 childIds，因此独立追加到画布坐标系，不参与主树间距计算。
  Object.values(document.nodes).filter((node) => node.isFreeTopic).forEach((node) => {
    const { width, height } = nodeSize(node, false, transientHeights?.get(node.id))
    output.push({ id: node.id, x: node.offsetX, y: node.offsetY, width, height })
  })
  return output
}
