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
// 与 .node-label 的 font-size: 12px / line-height: 1.45 保持一致，高度估算才不偏。
const TEXT_FONT_SIZE = 12
const TEXT_LINE_HEIGHT = TEXT_FONT_SIZE * 1.45
// 卡片纵向固定开销：上下 padding 12 + 文本内 padding 4 + 上下边框 2。
const NODE_VERTICAL_PADDING = 18
const HORIZONTAL_TEXT_PADDING = 44
// HTML 活预览：顶栏约 24px + iframe 150px + 上边距 7px；预览是定高元素，布局必须预留同样高度。
const HTML_PREVIEW_HEIGHT = 182
const HTML_PREVIEW_WIDTH = 252

/**
 * 文本实测（markmap/plait/mind-elixir 的通用做法）：用与渲染一致的字体在
 * canvas 2d 上下文里 measureText。浏览器/Tauri 都可用；jsdom 等无 canvas
 * 环境回退到按字符类型估算（CJK 1em、ASCII 约 0.56em），仅供测试使用。
 */
let measureContext: CanvasRenderingContext2D | null | undefined
const textWidthCache = new Map<string, number>()

function getMeasureContext() {
  if (measureContext === undefined) {
    try {
      measureContext = typeof document !== 'undefined'
        ? document.createElement('canvas').getContext('2d')
        : null
    } catch {
      measureContext = null
    }
  }
  return measureContext
}

const CJK_PATTERN = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/

function measureTextWidth(text: string, fontSize = TEXT_FONT_SIZE): number {
  const cacheKey = `${fontSize}|${text}`
  const cached = textWidthCache.get(cacheKey)
  if (cached !== undefined) return cached
  const context = getMeasureContext()
  let width: number
  if (context) {
    context.font = `${fontSize}px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
    width = context.measureText(text).width
  } else {
    width = 0
    for (const ch of text) width += CJK_PATTERN.test(ch) ? fontSize : fontSize * .56
  }
  if (textWidthCache.size > 5000) textWidthCache.clear()
  textWidthCache.set(cacheKey, width)
  return width
}

/** 模拟 word-break: break-word 的逐字符贪心换行；布局与 SVG 导出共用同一套测量。 */
export function wrapTextLine(line: string, maxTextWidth: number, fontSize = TEXT_FONT_SIZE): string[] {
  if (!line) return [' ']
  if (measureTextWidth(line, fontSize) <= maxTextWidth) return [line]
  const lines: string[] = []
  let current = ''
  let currentWidth = 0
  for (const ch of line) {
    const charWidth = measureTextWidth(ch, fontSize)
    if (current && currentWidth + charWidth > maxTextWidth) {
      lines.push(current)
      current = ch
      currentWidth = charWidth
    } else {
      current += ch
      currentWidth += charWidth
    }
  }
  if (current) lines.push(current)
  return lines
}

/** 返回单行文本在指定宽度下的实际行数。 */
function wrappedLineCount(line: string, maxTextWidth: number): number {
  return wrapTextLine(line, maxTextWidth).length
}

/**
 * 根据节点主题文本计算渲染尺寸。
 * - 宽度：canvas measureText 实测（无 canvas 时按字符类型估算），受 min/max 约束
 * - 高度：根节点 58px、子节点 44px 起步，每多一行文字 +17.4px（12px × 1.45 行高）
 */
function nodeSize(node: MindNode, isRoot: boolean, transientHeight?: number) {
  const topicLines = node.topic.split('\n')
  const longestLineWidth = Math.max(...topicLines.map((line) => measureTextWidth(line)), 1)
  const automaticWidth = Math.min(isRoot ? 260 : NODE_WIDTH + 36, Math.max(isRoot ? ROOT_WIDTH : 118, Math.ceil(longestLineWidth) + HORIZONTAL_TEXT_PADDING))
  const imageAttachment = node.attachments.find((attachment) => attachment.type.startsWith('image/'))
  const imagePreviewWidth = imageAttachment?.image?.displayWidth ?? (imageAttachment ? 156 : 0)
  const widthWithImage = imagePreviewWidth ? Math.min(MAX_NODE_WIDTH, imagePreviewWidth + 32) : 0
  const htmlPreviewWidth = node.attachments.some((attachment) => attachment.type === 'text/html') ? Math.min(MAX_NODE_WIDTH, HTML_PREVIEW_WIDTH) : 0
  const width = Math.max(isRoot ? ROOT_WIDTH : 118, node.width ?? automaticWidth, widthWithImage, htmlPreviewWidth)
  const maxTextWidth = Math.max(48, width - HORIZONTAL_TEXT_PADDING)
  const lines = Math.max(1, topicLines.reduce((count, line) => count + wrappedLineCount(line, maxTextWidth), 0))
  // 旧附件没有展示元数据时沿用历史 96px 缩略图高度；首次载入后会自动写入真实宽高比。
  const imagePreviewHeight = imageAttachment ? (imageAttachment.image ? imageDisplayHeight(imageAttachment.image) + 8 : 96) : 0
  const htmlPreviewHeight = node.attachments.some((attachment) => attachment.type === 'text/html') ? HTML_PREVIEW_HEIGHT : 0
  const automaticHeight = Math.max(isRoot ? ROOT_HEIGHT : NODE_HEIGHT, NODE_VERTICAL_PADDING + lines * TEXT_LINE_HEIGHT) + imagePreviewHeight + htmlPreviewHeight
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
