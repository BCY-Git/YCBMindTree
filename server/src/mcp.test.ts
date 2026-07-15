import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { insertBranch, type MapPayload } from './mcp.js'

describe('MCP branch insertion', () => {
  it('creates nodes with the complete current semantic and sizing fields', () => {
    const rootId = randomUUID()
    const now = Date.now()
    const payload: MapPayload = { id: randomUUID(), rootId, nodes: { [rootId]: { id: rootId, parentId: null, isFreeTopic: false, childIds: [], topic: '根', note: '', links: [], attachments: [], taskStatus: 'none', priority: 0, dueDate: null, marks: [], tagIds: [], collapsed: false, width: null, height: null, offsetX: 0, offsetY: 0, createdAt: now, updatedAt: now } } }

    const insertedId = insertBranch(payload, rootId, { topic: 'AI 分支', children: [] })

    expect(payload.nodes[insertedId]).toMatchObject({ marks: [], tagIds: [], width: null, height: null, taskStatus: 'none' })
  })
})
