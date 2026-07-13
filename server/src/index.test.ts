import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentRepository } from './document-repository.js'
import { createApp } from './index.js'

const temporaryDirectories: string[] = []
const host = '127.0.0.1:8787'
const appOptions = {
  devToken: 'test-development-token',
  allowRegistration: true,
  sessionLifetimeMs: 60_000,
  allowedHosts: [host],
  allowedOrigins: ['http://127.0.0.1:5174'],
}

function createTestApp() {
  const directory = mkdtempSync(join(tmpdir(), 'mindtree-server-route-test-'))
  temporaryDirectories.push(directory)
  return createApp(new DocumentRepository(join(directory, 'mindtree.db')), appOptions)
}

function api(app: ReturnType<typeof createApp>) {
  const client = request(app)
  return {
    get: (path: string) => client.get(path).set('Host', host),
    post: (path: string) => client.post(path).set('Host', host),
    put: (path: string) => client.put(path).set('Host', host),
  }
}

function documentPayload(title: string) {
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
        id: rootId, parentId: null, isFreeTopic: false, childIds: [], topic: title, note: '', links: [], attachments: [],
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

describe('account and pairing HTTP API', () => {
  it('registers, logs in, rejects a wrong password, and rejects an expired token', async () => {
    const app = createTestApp()
    const registered = await api(app).post('/api/v1/auth/register').send({ email: 'alice@example.com', password: 'correct horse battery staple' }).expect(201)
    expect(registered.body.user).toMatchObject({ id: 'local-user', email: 'alice@example.com' })
    expect(registered.body.token).toEqual(expect.any(String))

    await api(app).post('/api/v1/auth/login').send({ email: 'alice@example.com', password: 'incorrect password' }).expect(401)
    const loggedIn = await api(app).post('/api/v1/auth/login').send({ email: 'alice@example.com', password: 'correct horse battery staple' }).expect(200)
    expect(loggedIn.body.token).toEqual(expect.any(String))
    await api(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${loggedIn.body.token as string}`).send({}).expect(204)
    await api(app).get('/api/v1/documents').set('Authorization', `Bearer ${loggedIn.body.token as string}`).expect(401)

    const repository = new DocumentRepository(':memory:')
    const user = repository.registerAccount('expired@example.com', 'correct horse battery staple')!
    const expired = repository.createSession(user.id, -1)
    const expiredApp = createApp(repository, appOptions)
    await api(expiredApp).get('/api/v1/documents').set('Authorization', `Bearer ${expired}`).expect(401)
  })

  it('allows a pairing secret to be exchanged once only', async () => {
    const app = createTestApp()
    const registered = await api(app).post('/api/v1/auth/register').send({ email: 'alice@example.com', password: 'correct horse battery staple' }).expect(201)
    const token = registered.body.token as string
    const pairing = await api(app).post('/api/v1/pairings').set('Authorization', `Bearer ${token}`).send({}).expect(201)

    const payload = { secret: pairing.body.secret as string }
    const firstExchange = await api(app).post(`/api/v1/pairings/${pairing.body.pairingId}/exchange`).send(payload).expect(200)
    expect(firstExchange.body.token).toEqual(expect.any(String))
    await api(app).post(`/api/v1/pairings/${pairing.body.pairingId}/exchange`).send(payload).expect(401)
  })

  it('does not expose one account\'s documents to another account', async () => {
    const app = createTestApp()
    const alice = await api(app).post('/api/v1/auth/register').send({ email: 'alice@example.com', password: 'correct horse battery staple' }).expect(201)
    const bob = await api(app).post('/api/v1/auth/register').send({ email: 'bob@example.com', password: 'correct horse battery staple' }).expect(201)
    const payload = documentPayload('Alice 私有导图')

    await api(app).put(`/api/v1/documents/${payload.id}`).set('Authorization', `Bearer ${alice.body.token as string}`).send({ payload, baseVersion: 0 }).expect(201)
    await api(app).get('/api/v1/documents').set('Authorization', `Bearer ${bob.body.token as string}`).expect(200).expect({ documents: [] })
    await api(app).get(`/api/v1/documents/${payload.id}`).set('Authorization', `Bearer ${bob.body.token as string}`).expect(404)
    await api(app).put(`/api/v1/documents/${payload.id}`).set('Authorization', `Bearer ${bob.body.token as string}`).send({ payload, baseVersion: 1 }).expect(404)
    await api(app).get(`/api/v1/documents/${payload.id}`).set('Authorization', `Bearer ${alice.body.token as string}`).expect(200).expect((response) => {
      expect(response.body).toMatchObject({ id: payload.id, ownerId: 'local-user', title: 'Alice 私有导图' })
    })
  })
})
