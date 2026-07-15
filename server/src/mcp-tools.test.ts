import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import { DocumentRepository } from './document-repository.js'
import { createMindTreeMcp, insertBranch, type MapPayload } from './mcp.js'

const directories: string[] = []
afterEach(() => { while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true }) })

async function connectedMcp() {
  const directory = mkdtempSync(join(tmpdir(), 'mindtree-mcp-test-'))
  directories.push(directory)
  const repository = new DocumentRepository(join(directory, 'mindtree.db'))
  const rootId = randomUUID()
  const now = Date.now()
  const payload: MapPayload = { id: randomUUID(), rootId, nodes: { [rootId]: { id: rootId, parentId: null, isFreeTopic: false, childIds: [], topic: '项目', note: '', links: [], attachments: [], taskStatus: 'none', priority: 0, dueDate: null, marks: [], tagIds: [], collapsed: false, width: null, height: null, offsetX: 0, offsetY: 0, createdAt: now, updatedAt: now } } }
  const sourceNodeId = insertBranch(payload, rootId, { topic: '日报', children: [{ topic: 'PPT 已交付', children: [] }] })
  repository.save({ id: payload.id, ownerId: 'local-user', title: '项目', categoryId: '', payload, baseVersion: 0 })
  const server = createMindTreeMcp(repository)
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { client, server, repository, payload, sourceNodeId }
}

describe('MCP deposit tools', () => {
  it('searches nodes with structured filters and returns their map path and semantics', async () => {
    const { client, server, repository, payload } = await connectedMcp()
    const resultNode = Object.values(payload.nodes).find((node) => node.topic === 'PPT 已交付')!
    resultNode.note = '等待专家验收'
    resultNode.taskStatus = 'doing'
    resultNode.tagIds = ['afsim']
    repository.save({ id: payload.id, ownerId: 'local-user', title: '项目', categoryId: '', payload, baseVersion: 1 })

    const result = await client.callTool({ name: 'mindtree_search_nodes', arguments: {
      query: '验收', statuses: ['doing'], tagIds: ['afsim'], priorities: [], marks: [], provenanceRoles: [], limit: 20,
    } })
    const response = JSON.parse((result.content as Array<{ text: string }>)[0].text) as Array<Record<string, unknown>>

    expect(response).toMatchObject([{
      documentId: payload.id, nodeId: resultNode.id, path: ['项目', '日报', 'PPT 已交付'],
      matchedIn: ['note'], taskStatus: 'doing', tagIds: ['afsim'],
    }])
    await client.close()
    await server.close()
  })

  it('searches confirmed deposit sources and generated targets by provenance role', async () => {
    const { client, server, payload, sourceNodeId } = await connectedMcp()
    const previewResult = await client.callTool({ name: 'mindtree_preview_deposit_plan', arguments: {
      documentId: payload.id, baseVersion: 1, sourceNodeIds: [sourceNodeId],
      candidates: [{ type: 'result', action: 'create', title: '阶段成果', detail: '已完成验收', sourceNodeIds: [sourceNodeId], targetNodeId: payload.rootId }],
    } })
    const preview = JSON.parse((previewResult.content as Array<{ text: string }>)[0].text) as { batchId: string; confirmationToken: string }
    await client.callTool({ name: 'mindtree_apply_deposit_plan', arguments: { batchId: preview.batchId, confirmationToken: preview.confirmationToken, confirmed: true } })

    const sourceResult = await client.callTool({ name: 'mindtree_search_nodes', arguments: { query: '日报', provenanceRoles: ['source'] } })
    const sourceNodes = JSON.parse((sourceResult.content as Array<{ text: string }>)[0].text) as Array<{ nodeId: string; provenanceRoles: string[] }>
    const targetResult = await client.callTool({ name: 'mindtree_search_nodes', arguments: { query: '阶段成果', provenanceRoles: ['target'] } })
    const targetNodes = JSON.parse((targetResult.content as Array<{ text: string }>)[0].text) as Array<{ topic: string; provenanceRoles: string[] }>

    expect(sourceNodes).toMatchObject([{ nodeId: sourceNodeId, provenanceRoles: ['source'] }])
    expect(targetNodes).toMatchObject([{ topic: '阶段成果', provenanceRoles: ['target'] }])
    await client.close()
    await server.close()
  })

  it('returns a bounded source context without changing the map', async () => {
    const { client, server, payload, sourceNodeId } = await connectedMcp()
    const result = await client.callTool({ name: 'mindtree_analyze_deposit', arguments: { documentId: payload.id, sourceNodeId } })
    const response = JSON.parse((result.content as Array<{ text: string }>)[0].text) as { context: { nodes: Array<{ topic: string }> }; currentVersion: number }

    expect(response.context.nodes.map((node) => node.topic)).toEqual(['日报', 'PPT 已交付'])
    expect(response.currentVersion).toBe(1)
    await client.close()
    await server.close()
  })

  it('stores a validated preview batch while leaving the document version unchanged', async () => {
    const { client, server, repository, payload, sourceNodeId } = await connectedMcp()
    const result = await client.callTool({ name: 'mindtree_preview_deposit_plan', arguments: {
      documentId: payload.id,
      baseVersion: 1,
      sourceNodeIds: [sourceNodeId],
      candidates: [{ type: 'result', action: 'create', title: '阶段成果', detail: 'PPT 已交付', sourceNodeIds: [sourceNodeId], targetNodeId: payload.rootId }],
    } })
    const response = JSON.parse((result.content as Array<{ text: string }>)[0].text) as { batchId: string; confirmationToken: string; changes: string[] }

    expect(response.changes).toEqual(['新增「阶段成果」到「项目」'])
    expect(response.confirmationToken.length).toBeGreaterThan(20)
    expect(repository.get('local-user', payload.id)?.version).toBe(1)
    await client.close()
    await server.close()
  })

  it('applies a preview only through its explicit confirmation token and matching version', async () => {
    const { client, server, repository, payload, sourceNodeId } = await connectedMcp()
    const previewResult = await client.callTool({ name: 'mindtree_preview_deposit_plan', arguments: {
      documentId: payload.id, baseVersion: 1, sourceNodeIds: [sourceNodeId],
      candidates: [{ type: 'result', action: 'create', title: '阶段成果', detail: 'PPT 已交付', sourceNodeIds: [sourceNodeId], targetNodeId: payload.rootId }],
    } })
    const preview = JSON.parse((previewResult.content as Array<{ text: string }>)[0].text) as { batchId: string; confirmationToken: string }

    const applyResult = await client.callTool({ name: 'mindtree_apply_deposit_plan', arguments: { batchId: preview.batchId, confirmationToken: preview.confirmationToken, confirmed: true } })
    const applied = JSON.parse((applyResult.content as Array<{ text: string }>)[0].text) as { version: number; affectedNodeIds: string[] }

    expect(applied.version).toBe(2)
    expect(applied.affectedNodeIds).toHaveLength(1)
    expect(Object.values((repository.get('local-user', payload.id)?.payload as MapPayload).nodes).some((node) => node.topic === '阶段成果')).toBe(true)
    expect(repository.getMcpDepositBatch('local-user', preview.batchId)?.status).toBe('applied')
    await client.close()
    await server.close()
  })

  it('lists pending review batches without returning their confirmation tokens', async () => {
    const { client, server, payload, sourceNodeId } = await connectedMcp()
    await client.callTool({ name: 'mindtree_preview_deposit_plan', arguments: {
      documentId: payload.id, baseVersion: 1, sourceNodeIds: [sourceNodeId],
      candidates: [{ type: 'result', action: 'create', title: '阶段成果', detail: '', sourceNodeIds: [sourceNodeId], targetNodeId: payload.rootId }],
    } })

    const listResult = await client.callTool({ name: 'mindtree_list_deposit_batches', arguments: { status: 'pending' } })
    const response = JSON.parse((listResult.content as Array<{ text: string }>)[0].text) as { batches: Array<Record<string, unknown>> }

    expect(response.batches).toHaveLength(1)
    expect(response.batches[0].status).toBe('pending')
    expect(response.batches[0]).not.toHaveProperty('confirmationToken')
    await client.close()
    await server.close()
  })
})
