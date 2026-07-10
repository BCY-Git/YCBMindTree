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

/**
 * 根据节点主题文本计算渲染尺寸。
 * - 宽度：按最长行 × 8.5px 估算，受 min/max 约束
 * - 高度：根节点 58px，子节点 44px，每多一行文字 +20px
 */
function nodeSize(node: MindNode, isRoot: boolean) {
  const longestLine = Math.max(...node.topic.split('\n').map((line) => line.length), 1)
  const width = Math.min(isRoot ? 260 : NODE_WIDTH + 36, Math.max(isRoot ? ROOT_WIDTH : 118, longestLine * 8.5 + 44))
  const lines = Math.max(1, Math.ceil(node.topic.length / Math.max(12, Math.floor((width - 36) / 8.5))))
  return { width, height: (isRoot ? ROOT_HEIGHT : NODE_HEIGHT) + (lines - 1) * 20 }
}

export function layoutTree(document: MindMapDocument): PositionedNode[] {
  // ── 第一遍：自底向上计算每棵子树的所需高度 ─────────────────────────
  // 折叠节点不展开其子节点，等同于叶子节点处理。
  const heights = new Map<string, number>()
  const measure = (id: string): number => {
    const node = document.nodes[id]
    const ownHeight = nodeSize(node, id === document.rootId).height
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
    const { width, height } = nodeSize(node, id === document.rootId)
    const subtreeHeight = heights.get(id) ?? height
    // 节点 y = 子树顶 + (子树高度 - 节点自身高度) / 2 → 垂直居中
    const y = top + (subtreeHeight - height) / 2
    // 叠加节点的自由偏移量，支持用户手动拖拽微调。
    output.push({ id, x: x + node.offsetX, y: y + node.offsetY, width, height })
    if (node.collapsed) return
    const children = node.childIds
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
  return output
}
