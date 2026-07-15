import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DocumentRecord } from './document-repository.js'
import { applyMcpDepositPreview, createMcpDepositPreview } from './mcp-deposit.js'
import { insertBranch, type MapPayload } from './mcp.js'

function documentFixture(): { document: DocumentRecord; sourceNodeId: string } {
  const rootId = randomUUID()
  const now = Date.now()
  const payload: MapPayload = { id: randomUUID(), rootId, nodes: { [rootId]: { id: rootId, parentId: null, isFreeTopic: false, childIds: [], topic: '项目', note: '', links: [], attachments: [], taskStatus: 'none', priority: 0, dueDate: null, marks: [], tagIds: [], collapsed: false, width: null, height: null, offsetX: 0, offsetY: 0, createdAt: now, updatedAt: now } } }
  const sourceNodeId = insertBranch(payload, rootId, { topic: '日报', children: [] })
  return { document: { id: payload.id, ownerId: 'owner-1', title: '项目', categoryId: '', version: 4, payload, createdAt: now, updatedAt: now }, sourceNodeId }
}

describe('MCP deposit preview', () => {
  it('creates a confirmation-bound preview without changing the document', () => {
    const { document, sourceNodeId } = documentFixture()
    const before = structuredClone(document.payload)

    const preview = createMcpDepositPreview(document, {
      sourceNodeIds: [sourceNodeId],
      candidates: [{ type: 'result', action: 'create', title: 'PPT 已交付', detail: '已发送给负责人', sourceNodeIds: [sourceNodeId], targetNodeId: (document.payload as MapPayload).rootId }],
    })

    expect(preview.changes).toEqual(['新增「PPT 已交付」到「项目」'])
    expect(preview.confirmationToken.length).toBeGreaterThan(20)
    expect(document.payload).toEqual(before)
  })

  it('applies a confirmed preview to a clone only when its token and version still match', () => {
    const { document, sourceNodeId } = documentFixture()
    const rootId = (document.payload as MapPayload).rootId
    const preview = createMcpDepositPreview(document, {
      sourceNodeIds: [sourceNodeId],
      candidates: [{ type: 'result', action: 'create', title: 'PPT 已交付', detail: '已发送给负责人', sourceNodeIds: [sourceNodeId], targetNodeId: rootId }],
    })

    const result = applyMcpDepositPreview(document, preview, { confirmed: true, confirmationToken: preview.confirmationToken })

    expect(result.payload.nodes[rootId].childIds).toHaveLength(2)
    expect(Object.values(result.payload.nodes).some((node) => node.topic === 'PPT 已交付' && node.note === '已发送给负责人')).toBe(true)
    expect((document.payload as MapPayload).nodes[rootId].childIds).toHaveLength(1)
  })
})
