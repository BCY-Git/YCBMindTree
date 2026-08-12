import type { MindMapDocument, MindNode } from '@/domain/document.types'

export type InternalNodeLinkTarget = { documentId: string; nodeId: string }
export type InternalNodeLinkResolution =
  | { status: 'ok'; document: MindMapDocument; node: MindNode }
  | { status: 'missing-document' }
  | { status: 'missing-node'; document: MindMapDocument }

export function createInternalNodeLink(documentId: string, nodeId: string) {
  const params = new URLSearchParams({ document: documentId, node: nodeId })
  return `mindtree://node?${params.toString()}`
}

export function parseInternalNodeLink(value: string): InternalNodeLinkTarget | null {
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'mindtree:' || url.hostname !== 'node') return null
  const documentId = url.searchParams.get('document')?.trim()
  const nodeId = url.searchParams.get('node')?.trim()
  return documentId && nodeId ? { documentId, nodeId } : null
}

export function resolveInternalNodeLink(value: string, documents: MindMapDocument[]): InternalNodeLinkResolution {
  const target = parseInternalNodeLink(value)
  if (!target) return { status: 'missing-document' }
  const document = documents.find((item) => item.id === target.documentId)
  if (!document) return { status: 'missing-document' }
  const node = document.nodes[target.nodeId]
  return node ? { status: 'ok', document, node } : { status: 'missing-node', document }
}
