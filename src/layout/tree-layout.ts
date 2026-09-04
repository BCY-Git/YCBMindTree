/**
 * XMind 风格的右向紧凑树布局。
 *
 * 传统的“子树矩形堆叠”会让一条很深的分支替同级节点预留整块空白，也会让父节点
 * 偏离直接子节点的视觉中心。这里改用 tidy-tree 的轮廓碰撞思路：递归布局每个子树，
 * 仅比较相同相对深度上真正可能相撞的卡片，再把父节点放到最上、最下两个直接
 * 子节点的中心。这样两子节点永远关于父节点对称，同时不会为不存在的碰撞浪费空间。
 */
import type { MindMapDocument, MindNode } from '@/domain/document.types'
import { MAX_NODE_WIDTH } from '@/domain/layout-limits'
import { imageDisplayHeight } from '@/attachments/image-presentation'

export type PositionedNode = { id: string; x: number; y: number; width: number; height: number }

type LocalNode = {
  id: string
  x: number
  centerY: number
  width: number
  height: number
}

// 节点宽高常量（px）。宽度根据主题文本长度动态计算（见 nodeSize 函数）。
const ROOT_WIDTH = 196
const NODE_WIDTH = 176
const NODE_HEIGHT = 44
const ROOT_HEIGHT = 58
const TEXT_CHARACTER_WIDTH = 11
const HORIZONTAL_TEXT_PADDING = 44
// HTML 附件卡片（约 26px）+ 上边距 7px；卡片是定高元素，布局必须预留同样高度。
const HTML_PREVIEW_HEIGHT = 33

/**
 * 根据节点主题文本计算渲染尺寸。
 * - 宽度：按中英文混合文本宽度估算，受 min/max 约束
 * - 高度：根节点 58px，子节点 44px，每多一行文字 +20px
 */
function nodeSize(node: MindNode, isRoot: boolean, transientHeight?: number) {
  const longestLine = Math.max(...node.topic.split('\n').map((line) => line.length), 1)
  const automaticWidth = Math.min(isRoot ? 260 : NODE_WIDTH + 36, Math.max(isRoot ? ROOT_WIDTH : 118, longestLine * TEXT_CHARACTER_WIDTH + HORIZONTAL_TEXT_PADDING))
  const imageAttachment = node.attachments.find((attachment) => attachment.type.startsWith('image/'))
  const imagePreviewWidth = imageAttachment?.image?.displayWidth ?? (imageAttachment ? 156 : 0)
  const widthWithImage = imagePreviewWidth ? Math.min(MAX_NODE_WIDTH, imagePreviewWidth + 32) : 0
  const width = Math.max(isRoot ? ROOT_WIDTH : 118, node.width ?? automaticWidth, widthWithImage)
  const charactersPerLine = Math.max(8, Math.floor((width - HORIZONTAL_TEXT_PADDING) / TEXT_CHARACTER_WIDTH))
  const lines = Math.max(1, node.topic.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0))
  // 旧附件没有展示元数据时沿用历史 96px 缩略图高度；首次载入后会自动写入真实宽高比。
  const imagePreviewHeight = imageAttachment ? (imageAttachment.image ? imageDisplayHeight(imageAttachment.image) + 8 : 96) : 0
  const htmlPreviewHeight = node.attachments.some((attachment) => attachment.type === 'text/html') ? HTML_PREVIEW_HEIGHT : 0
  const automaticHeight = (isRoot ? ROOT_HEIGHT : NODE_HEIGHT) + (lines - 1) * 20 + imagePreviewHeight + htmlPreviewHeight
  return { width, height: Math.max(node.height ?? 0, automaticHeight, transientHeight ?? 0) }
}

/**
 * `transientHeights` 只服务于编辑中的节点（例如 AI 幽灵续写临时撑高卡片）。
 * 它不写入文档，也不会污染撤销历史；结束编辑后布局自然回到持久化尺寸。
 */
export function layoutTree(document: MindMapDocument, transientHeights?: ReadonlyMap<string, number>): PositionedNode[] {
  /**
   * 返回以当前节点左侧为 x=0、中心为 y=0 的局部布局。依次放入子树时比较所有
   * 横向范围真正相交的卡片，兼容手动放大的宽节点；放完后再整体平移，使首尾
   * 直接子节点围绕父节点严格对称。
   */
  const compose = (id: string): LocalNode[] => {
    const node = document.nodes[id]
    const ownSize = nodeSize(node, id === document.rootId, transientHeights?.get(id))
    const children = node.collapsed ? [] : node.childIds
    if (!children.length) return [{ id, x: 0, centerY: 0, ...ownSize }]

    const placedChildren: Array<{ rootCenterY: number; nodes: LocalNode[] }> = []
    const placedNodes: LocalNode[] = []

    children.forEach((childId, childIndex) => {
      const childNodes = compose(childId).map((childNode) => ({
        ...childNode,
        x: childNode.x + ownSize.width + document.layout.levelGap,
      }))
      let shift = 0
      if (childIndex > 0) {
        childNodes.forEach((childNode) => {
          const childTop = childNode.centerY - childNode.height / 2
          placedNodes.forEach((placedNode) => {
            const overlapsHorizontally = placedNode.x < childNode.x + childNode.width
              && childNode.x < placedNode.x + placedNode.width
            if (!overlapsHorizontally) return
            const placedBottom = placedNode.centerY + placedNode.height / 2
            shift = Math.max(shift, placedBottom + document.layout.siblingGap - childTop)
          })
        })
      }

      const shifted = childNodes.map((childNode) => ({
        ...childNode,
        centerY: childNode.centerY + shift,
      }))
      placedNodes.push(...shifted)
      placedChildren.push({ rootCenterY: shift, nodes: shifted })
    })

    const firstCenter = placedChildren[0].rootCenterY
    const lastCenter = placedChildren.at(-1)?.rootCenterY ?? firstCenter
    const childrenMidpoint = (firstCenter + lastCenter) / 2
    return [
      { id, x: 0, centerY: 0, ...ownSize },
      ...placedChildren.flatMap((child) => child.nodes.map((childNode) => ({
        ...childNode,
        centerY: childNode.centerY - childrenMidpoint,
      }))),
    ]
  }

  const output: PositionedNode[] = []
  const placeComposedTree = (rootId: string, rootX: number, rootCenterY: number, anchorFreeRoot: boolean) => {
    const localNodes = compose(rootId)
    localNodes.forEach((item) => {
      const node = document.nodes[item.id]
      output.push({
        id: item.id,
        x: rootX + item.x + (anchorFreeRoot && item.id === rootId ? 0 : node.offsetX),
        y: rootCenterY + item.centerY - item.height / 2 + (anchorFreeRoot && item.id === rootId ? 0 : node.offsetY),
        width: item.width,
        height: item.height,
      })
    })
  }

  const rootSize = nodeSize(document.nodes[document.rootId], true, transientHeights?.get(document.rootId))
  placeComposedTree(document.rootId, 0, rootSize.height / 2, false)
  // 每个自由主题都是一棵独立树的根。它的 offsetX/Y 是根卡片在画布中的锚点，
  // 后代仍由同一套递归布局计算，因此整支拖出后不会丢失结构。
  Object.values(document.nodes).filter((node) => node.isFreeTopic).forEach((node) => {
    const size = nodeSize(node, false, transientHeights?.get(node.id))
    placeComposedTree(node.id, node.offsetX, node.offsetY + size.height / 2, true)
  })
  return output
}
