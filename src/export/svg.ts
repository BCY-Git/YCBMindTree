import type { MindMapDocument } from '../domain/document.types'
import { getTheme } from '../domain/themes'
import { layoutTree, type PositionedNode } from '../layout/tree-layout'

type SvgExportOptions = { transparent?: boolean }

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

function depthOf(document: MindMapDocument, nodeId: string) {
  let depth = 0
  let current = document.nodes[nodeId]
  const seen = new Set<string>()
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id)
    depth += 1
    current = document.nodes[current.parentId]
  }
  return depth
}

function textLines(topic: string, width: number) {
  const charactersPerLine = Math.max(8, Math.floor((width - 32) / 11))
  return topic.split('\n').flatMap((line) => {
    const chars = Array.from(line || ' ')
    const lines: string[] = []
    for (let index = 0; index < chars.length; index += charactersPerLine) lines.push(chars.slice(index, index + charactersPerLine).join(''))
    return lines.length ? lines : [' ']
  })
}

function treePath(parent: PositionedNode, child: PositionedNode, shiftX: number, shiftY: number) {
  const childOnRight = child.x + child.width / 2 >= parent.x + parent.width / 2
  const startX = (childOnRight ? parent.x + parent.width : parent.x) + shiftX
  const endX = (childOnRight ? child.x : child.x + child.width) + shiftX
  const startY = parent.y + parent.height / 2 + shiftY
  const endY = child.y + child.height / 2 + shiftY
  const controlX = startX + (endX - startX) * 0.5
  return `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`
}

/** 直接从领域文档生成完整 SVG；不读取 ReactFlow 视口，因此缩放和平移不会裁掉内容。 */
export function exportDocumentSvg(document: MindMapDocument, options: SvgExportOptions = {}) {
  const positions = layoutTree(document)
  if (!positions.length) throw new Error('当前导图没有可导出的节点')
  const byId = new Map(positions.map((node) => [node.id, node]))
  const minX = Math.min(...positions.map((node) => node.x))
  const minY = Math.min(...positions.map((node) => node.y))
  const maxX = Math.max(...positions.map((node) => node.x + node.width))
  const maxY = Math.max(...positions.map((node) => node.y + node.height))
  const padding = 52
  const width = Math.ceil(maxX - minX + padding * 2)
  const height = Math.ceil(maxY - minY + padding * 2)
  const shiftX = padding - minX
  const shiftY = padding - minY
  const theme = getTheme(document.theme.id)

  const treeEdges: string[] = []
  positions.forEach((child) => {
    const node = document.nodes[child.id]
    if (!node.parentId) return
    const parent = byId.get(node.parentId)
    if (!parent) return
    const depth = depthOf(document, child.id)
    const color = theme.palette[Math.max(0, depth - 1) % theme.palette.length]
    treeEdges.push(`<path data-tree-edge="${escapeXml(node.parentId)}:${escapeXml(node.id)}" d="${treePath(parent, child, shiftX, shiftY)}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`)
  })

  const relationEdges = document.relations.flatMap((relation) => {
    const source = byId.get(relation.sourceId)
    const target = byId.get(relation.targetId)
    if (!source || !target) return []
    const x1 = source.x + source.width / 2 + shiftX
    const y1 = source.y + source.height / 2 + shiftY
    const x2 = target.x + target.width / 2 + shiftX
    const y2 = target.y + target.height / 2 + shiftY
    const label = relation.label.trim()
    return [`<g data-relation-edge="${escapeXml(relation.id)}"><path d="M ${x1} ${y1} Q ${(x1 + x2) / 2} ${Math.min(y1, y2) - 26}, ${x2} ${y2}" fill="none" stroke="${theme.branch}" stroke-width="2" stroke-dasharray="8 7" marker-end="url(#relation-arrow)"/>${label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 10}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="12" font-weight="650" fill="${theme.nodeText}">${escapeXml(label)}</text>` : ''}</g>`]
  })

  const nodes = positions.map((position) => {
    const node = document.nodes[position.id]
    const isRoot = node.id === document.rootId
    const depth = depthOf(document, node.id)
    const branchColor = isRoot ? theme.rootBackground : theme.palette[Math.max(0, depth - 1) % theme.palette.length]
    const background = isRoot ? theme.rootBackground : theme.nodeBackground
    const textColor = isRoot ? theme.rootText : theme.nodeText
    const x = position.x + shiftX
    const y = position.y + shiftY
    const lines = textLines(node.topic, position.width)
    const lineHeight = 20
    const firstY = y + position.height / 2 - ((lines.length - 1) * lineHeight) / 2 + 5
    const tspans = lines.map((line, index) => `<tspan x="${x + 18}" y="${firstY + index * lineHeight}">${escapeXml(line)}</tspan>`).join('')
    const collapsedCount = node.collapsed ? node.childIds.length : 0
    return `<g data-node-id="${escapeXml(node.id)}"><rect x="${x}" y="${y}" width="${position.width}" height="${position.height}" rx="${isRoot ? 15 : 11}" fill="${background}" stroke="${branchColor}" stroke-width="${isRoot ? 0 : 1.5}"/><rect x="${x}" y="${y}" width="7" height="${position.height}" rx="3.5" fill="${branchColor}"/><text font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif" font-size="${isRoot ? 16 : 14}" font-weight="${isRoot ? 720 : 620}" fill="${textColor}">${tspans}</text>${collapsedCount ? `<g><circle cx="${x + position.width + 16}" cy="${y + position.height / 2}" r="14" fill="${theme.surface}" stroke="${branchColor}" stroke-width="2"/><text x="${x + position.width + 16}" y="${y + position.height / 2 + 5}" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="12" fill="${branchColor}">${collapsedCount}</text></g>` : ''}</g>`
  })

  const background = options.transparent ? '' : `<rect width="100%" height="100%" fill="${theme.canvas}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(document.title)}"><title>${escapeXml(document.title)}</title><defs><marker id="relation-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${theme.branch}"/></marker></defs>${background}${treeEdges.join('')}${relationEdges.join('')}${nodes.join('')}</svg>`
}

export function downloadDocumentSvg(document: MindMapDocument, options?: SvgExportOptions) {
  const safeName = document.title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'mindtree'
  const blob = new Blob([exportDocumentSvg(document, options)], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url
  link.download = `${safeName}.svg`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
