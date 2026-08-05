import type { MindMapDocument } from '../domain/document.types'
import { getTheme } from '../domain/themes'
import { relationControlPoint, relationDashArray, relationPath } from '../editor/relation-geometry'
import { layoutTree, type PositionedNode } from '../layout/tree-layout'
import { getNodeAttachment } from '../persistence/database'
import { saveExportFile } from './export-file'

type SvgExportOptions = { transparent?: boolean; images?: Record<string, string> }

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

  const relationMarkers: string[] = []
  const relationEdges = document.relations.flatMap((relation) => {
    const source = byId.get(relation.sourceId)
    const target = byId.get(relation.targetId)
    if (!source || !target) return []
    const targetIsRight = target.x + target.width / 2 >= source.x + source.width / 2
    const x1 = (targetIsRight ? source.x + source.width : source.x) + shiftX
    const y1 = source.y + source.height / 2 + shiftY
    const x2 = (targetIsRight ? target.x : target.x + target.width) + shiftX
    const y2 = target.y + target.height / 2 + shiftY
    const control = relationControlPoint({ x: x1, y: y1 }, { x: x2, y: y2 }, relation.controlOffsetX, relation.controlOffsetY)
    const geometry = relationPath({ x: x1, y: y1 }, { x: x2, y: y2 }, control)
    const color = relation.color ?? theme.branch
    const dashArray = relationDashArray(relation.lineStyle)
    const markerId = `relation-arrow-${relation.id}`
    relationMarkers.push(`<marker id="${escapeXml(markerId)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`)
    const label = relation.label.trim()
    return [`<g data-relation-edge="${escapeXml(relation.id)}"><path d="${geometry.path}" fill="none" stroke="${color}" stroke-width="2"${dashArray ? ` stroke-dasharray="${dashArray}"` : ''} stroke-linecap="round" marker-end="url(#${escapeXml(markerId)})"/>${label ? `<text x="${geometry.label.x}" y="${geometry.label.y - 9}" text-anchor="middle" paint-order="stroke" stroke="${theme.canvas}" stroke-width="7" stroke-linejoin="round" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="12" font-weight="650" fill="${theme.nodeText}">${escapeXml(label)}</text>` : ''}</g>`]
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
    const imageAttachment = node.attachments.find((attachment) => attachment.type.startsWith('image/'))
    const imageUrl = imageAttachment ? options.images?.[imageAttachment.id] : undefined
    const lineHeight = 20
    const firstY = imageAttachment ? y + 23 : y + position.height / 2 - ((lines.length - 1) * lineHeight) / 2 + 5
    const tspans = lines.map((line, index) => `<tspan x="${x + 18}" y="${firstY + index * lineHeight}">${escapeXml(line)}</tspan>`).join('')
    const collapsedCount = node.collapsed ? node.childIds.length : 0
    const imageX = x + 10
    const imageY = y + position.height - 86
    const imageWidth = position.width - 20
    const image = imageAttachment ? imageUrl
      ? `<clipPath id="image-clip-${escapeXml(node.id)}"><rect x="${imageX}" y="${imageY}" width="${imageWidth}" height="76" rx="6"/></clipPath><image data-attachment-id="${escapeXml(imageAttachment.id)}" href="${escapeXml(imageUrl)}" x="${imageX}" y="${imageY}" width="${imageWidth}" height="76" preserveAspectRatio="xMidYMid slice" clip-path="url(#image-clip-${escapeXml(node.id)})"/>`
      : `<rect x="${imageX}" y="${imageY}" width="${imageWidth}" height="76" rx="6" fill="${theme.nodeBorder}" opacity=".28"/><text x="${x + position.width / 2}" y="${imageY + 42}" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="10" fill="${textColor}" opacity=".58">${escapeXml(imageAttachment.name)}</text>`
      : ''
    return `<g data-node-id="${escapeXml(node.id)}"><rect x="${x}" y="${y}" width="${position.width}" height="${position.height}" rx="${isRoot ? 15 : 11}" fill="${background}" stroke="${branchColor}" stroke-width="${isRoot ? 0 : 1.5}"/><rect x="${x}" y="${y}" width="7" height="${position.height}" rx="3.5" fill="${branchColor}"/><text font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif" font-size="${isRoot ? 16 : 14}" font-weight="${isRoot ? 720 : 620}" fill="${textColor}">${tspans}</text>${image}${collapsedCount ? `<g><circle cx="${x + position.width + 16}" cy="${y + position.height / 2}" r="14" fill="${theme.surface}" stroke="${branchColor}" stroke-width="2"/><text x="${x + position.width + 16}" y="${y + position.height / 2 + 5}" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="12" fill="${branchColor}">${collapsedCount}</text></g>` : ''}</g>`
  })

  const background = options.transparent ? '' : `<rect width="100%" height="100%" fill="${theme.canvas}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(document.title)}"><title>${escapeXml(document.title)}</title><defs>${relationMarkers.join('')}</defs>${background}${treeEdges.join('')}${relationEdges.join('')}${nodes.join('')}</svg>`
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

export async function loadDocumentImageDataUrls(document: MindMapDocument): Promise<Record<string, string>> {
  const images = Object.values(document.nodes).flatMap((node) => node.attachments).filter((attachment) => attachment.type.startsWith('image/'))
  const pairs = await Promise.all(images.map(async (attachment) => {
    const stored = await getNodeAttachment(attachment.id)
    return stored ? [attachment.id, await blobToDataUrl(stored.blob)] as const : null
  }))
  return Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => Boolean(pair)))
}

export async function downloadDocumentSvg(document: MindMapDocument, options: SvgExportOptions = {}) {
  const safeName = document.title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'mindtree'
  const images = options.images ?? await loadDocumentImageDataUrls(document)
  const suffix = options.transparent ? '-transparent' : ''
  return saveExportFile({
    content: exportDocumentSvg(document, { ...options, images }),
    suggestedName: `${safeName}${suffix}.svg`,
    dialogTitle: options.transparent ? '导出透明背景 SVG' : '导出完整导图 SVG',
    typeName: 'SVG',
    extensions: ['svg'],
    mimeType: 'image/svg+xml;charset=utf-8',
  })
}
