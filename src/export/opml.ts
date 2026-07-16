import type { MindMapDocument } from '../domain/document.types'
import { saveExportFile } from './export-file'
import { createDocumentFromOutline, fileStem, type ImportedDocument, type ImportedOutlineNode } from './import-document'

function outlineFromElement(element: Element): ImportedOutlineNode {
  const topic = element.getAttribute('text') ?? element.getAttribute('title') ?? ''
  return {
    topic: topic.trim() || '未命名主题',
    note: element.getAttribute('_note') ?? element.getAttribute('note') ?? '',
    collapsed: element.getAttribute('_status') === 'collapsed',
    children: Array.from(element.children).filter((child) => child.tagName.toLowerCase() === 'outline').map(outlineFromElement),
  }
}

export function parseOpml(content: string, fileName: string): ImportedDocument {
  const xml = new DOMParser().parseFromString(content, 'application/xml')
  if (xml.querySelector('parsererror') || xml.documentElement.tagName.toLowerCase() !== 'opml') {
    throw new Error('OPML XML 格式无效')
  }
  const body = Array.from(xml.documentElement.children).find((element) => element.tagName.toLowerCase() === 'body')
  const outlines = body ? Array.from(body.children).filter((element) => element.tagName.toLowerCase() === 'outline') : []
  if (!outlines.length) throw new Error('OPML 中没有可导入的大纲')

  const head = Array.from(xml.documentElement.children).find((element) => element.tagName.toLowerCase() === 'head')
  const title = head ? Array.from(head.children).find((element) => element.tagName.toLowerCase() === 'title')?.textContent?.trim() : undefined
  const documentTitle = title || fileStem(fileName)
  const root = outlines.length === 1
    ? outlineFromElement(outlines[0])
    : { topic: documentTitle, children: outlines.map(outlineFromElement) }
  return createDocumentFromOutline(documentTitle, root)
}

function appendOutline(xml: XMLDocument, parent: Element, document: MindMapDocument, nodeId: string) {
  const node = document.nodes[nodeId]
  const outline = xml.createElement('outline')
  outline.setAttribute('text', node.topic)
  if (node.note.trim()) outline.setAttribute('_note', node.note.trim())
  if (node.collapsed && node.childIds.length) outline.setAttribute('_status', 'collapsed')
  parent.appendChild(outline)
  node.childIds.forEach((childId) => appendOutline(xml, outline, document, childId))
}

export function exportOpml(document: MindMapDocument): string {
  const xml = window.document.implementation.createDocument('', 'opml', null)
  const opml = xml.documentElement
  opml.setAttribute('version', '2.0')
  const head = xml.createElement('head')
  const title = xml.createElement('title')
  title.textContent = document.title
  head.appendChild(title)
  const body = xml.createElement('body')
  appendOutline(xml, body, document, document.rootId)
  opml.append(head, body)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(xml)}`
}

export function downloadOpml(document: MindMapDocument) {
  const safeName = document.title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'mindtree'
  return saveExportFile({
    content: exportOpml(document),
    suggestedName: `${safeName}.opml`,
    dialogTitle: '导出 OPML 大纲',
    typeName: 'OPML',
    extensions: ['opml'],
    mimeType: 'text/x-opml;charset=utf-8',
  })
}
