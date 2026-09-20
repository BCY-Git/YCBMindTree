import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentRepository } from './document-repository.js'
import { createApp } from './index.js'
import { collectAttachmentMeta } from './attachment-store.js'
import type { NestExpressApplication } from '@nestjs/platform-express'

const temporaryDirectories: string[] = []
const host = '127.0.0.1:8787'
const token = 'test-development-token'
const appOptions = {
  devToken: token,
  allowRegistration: false,
  sessionLifetimeMs: 60_000,
  allowedHosts: [host],
  allowedOrigins: ['http://127.0.0.1:5174'],
  aiAllowedHosts: ['api.deepseek.com'],
}

async function createTestApp() {
  const directory = mkdtempSync(join(tmpdir(), 'mindtree-attachment-test-'))
  temporaryDirectories.push(directory)
  const repository = new DocumentRepository(join(directory, 'mindtree.db'))
  return { app: await createApp(repository, appOptions), repository, directory }
}

function api(app: NestExpressApplication) {
  const client = request(app.getHttpServer())
  return {
    get: (path: string) => client.get(path).set('Host', host).set('Authorization', `Bearer ${token}`),
    put: (path: string) => client.put(path).set('Host', host).set('Authorization', `Bearer ${token}`),
  }
}

function documentPayload(title: string, attachments: Array<{ id: string; name: string; type: string; size: number; createdAt: number }> = []) {
  const documentId = randomUUID()
  const rootId = randomUUID()
  const now = Date.now()
  return {
    id: documentId,
    schemaVersion: 1 as const,
    title,
    categoryId: 'uncategorized',
    isDraft: false,
    origin: 'standard' as const,
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, parentId: null, isFreeTopic: false, childIds: [], topic: title, note: '', links: [], attachments,
        taskStatus: 'none' as const, priority: 0 as const, dueDate: null, collapsed: false, width: null, height: null,
        offsetX: 0, offsetY: 0, createdAt: now, updatedAt: now,
      },
    },
    relations: [], boundaries: [], summaries: [],
    layout: { levelGap: 96, siblingGap: 22, freeformOffsets: null },
    theme: { id: 'calm' as const },
    createdAt: now, updatedAt: now,
  }
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
})

describe('attachment routes', () => {
  it('uploads and downloads attachment bytes with auth', async () => {
    const { app } = await createTestApp()
    const attachmentId = randomUUID()
    const payload = documentPayload('带图导图', [{ id: attachmentId, name: '截图.png', type: 'image/png', size: 11, createdAt: Date.now() }])
    await api(app).put(`/api/v1/documents/${payload.id}`).send({ payload, baseVersion: 0 }).expect(201)

    const bytes = Buffer.from('fake-png-bytes')
    const uploaded = await api(app).put(`/api/v1/documents/${payload.id}/attachments/${attachmentId}`)
      .set('Content-Type', 'image/png')
      .send(bytes)
      .expect(201)
    expect(uploaded.body.ok).toBe(true)
    expect(uploaded.body.size).toBe(bytes.byteLength)

    const downloaded = await api(app).get(`/api/v1/documents/${payload.id}/attachments/${attachmentId}`).expect(200)
    expect(downloaded.headers['content-type']).toBe('image/png')
    expect(Buffer.compare(downloaded.body, bytes)).toBe(0)
  })

  it('rejects upload when metadata is not in the document, and serves 404 for missing bytes', async () => {
    const { app } = await createTestApp()
    const payload = documentPayload('空导图')
    await api(app).put(`/api/v1/documents/${payload.id}`).send({ payload, baseVersion: 0 }).expect(201)
    const attachmentId = randomUUID()
    await api(app).put(`/api/v1/documents/${payload.id}/attachments/${attachmentId}`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('x'))
      .expect(400)
    await api(app).get(`/api/v1/documents/${payload.id}/attachments/${attachmentId}`).expect(404)
  })

  it('requires authentication', async () => {
    const { app } = await createTestApp()
    const documentId = randomUUID()
    const attachmentId = randomUUID()
    await request(app.getHttpServer())
      .put(`/api/v1/documents/${documentId}/attachments/${attachmentId}`)
      .set('Host', host)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('x'))
      .expect(401)
  })

  it('prunes orphaned attachment bytes when a document snapshot no longer references them', async () => {
    const { app, repository } = await createTestApp()
    const attachmentId = randomUUID()
    const withAttachment = documentPayload('带图导图', [{ id: attachmentId, name: 'a.png', type: 'image/png', size: 1, createdAt: Date.now() }])
    await api(app).put(`/api/v1/documents/${withAttachment.id}`).send({ payload: withAttachment, baseVersion: 0 }).expect(201)
    await api(app).put(`/api/v1/documents/${withAttachment.id}/attachments/${attachmentId}`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('x'))
      .expect(201)
    expect(repository.attachments.has('local-user', withAttachment.id, attachmentId)).toBe(true)

    // 保存一个不再引用该附件的新快照后，字节应被清理。
    const stripped = documentPayload('带图导图')
    stripped.id = withAttachment.id
    stripped.rootId = withAttachment.rootId
    stripped.nodes = { [withAttachment.rootId]: { ...withAttachment.nodes[withAttachment.rootId], id: withAttachment.rootId, attachments: [] } }
    await api(app).put(`/api/v1/documents/${withAttachment.id}`).send({ payload: stripped, baseVersion: 1 }).expect(201)
    expect(repository.attachments.has('local-user', withAttachment.id, attachmentId)).toBe(false)
  })
})

describe('collectAttachmentMeta', () => {
  it('collects metadata across nodes and tolerates malformed payloads', () => {
    const payload = documentPayload('x', [{ id: 'a', name: 'a.png', type: 'image/png', size: 1, createdAt: 1 }])
    expect(collectAttachmentMeta(payload)).toEqual([{ id: 'a', name: 'a.png', type: 'image/png', size: 1, createdAt: 1 }])
    expect(collectAttachmentMeta(null)).toEqual([])
    expect(collectAttachmentMeta({ nodes: { n: { attachments: [{ id: 1 }] } } })).toEqual([])
  })
})
