import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentRepository } from './document-repository.js'
import { createApp } from './index.js'
import type { NestExpressApplication } from '@nestjs/platform-express'

const temporaryDirectories: string[] = []
const host = '127.0.0.1:8787'
const appOptions = {
  devToken: 'test-development-token',
  allowRegistration: true,
  sessionLifetimeMs: 60_000,
  allowedHosts: [host],
  allowedOrigins: ['http://127.0.0.1:5174'],
  aiAllowedHosts: ['api.deepseek.com', 'api.openai.com'],
}

async function createTestApp() {
  const directory = mkdtempSync(join(tmpdir(), 'mindtree-server-route-test-'))
  temporaryDirectories.push(directory)
  return createApp(new DocumentRepository(join(directory, 'mindtree.db')), appOptions)
}

function api(app: NestExpressApplication) {
  const client = request(app.getHttpServer())
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
  vi.unstubAllGlobals()
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
})

describe('AI production proxy', () => {
  it('forwards image content larger than the default 1 MB body limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"choices":[]}'))
    vi.stubGlobal('fetch', fetchMock)
    const app = await createTestApp()
    const payload = { model: 'vision-model', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(1_100_000) } }] }] }
    await api(app).post('/api/ai/chat')
      .set('Authorization', 'Bearer sk-test-provider-key')
      .send({ endpoint: 'https://api.deepseek.com/chat/completions', request: payload })
      .expect(200)
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/chat/completions', expect.objectContaining({ body: JSON.stringify(payload) }))
  })

  it('forwards a validated HTTPS request and returns the upstream response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const app = await createTestApp()

    await api(app).post('/api/ai/chat')
      .set('Authorization', 'Bearer sk-test-provider-key')
      .send({ endpoint: 'https://api.deepseek.com/chat/completions', request: { model: 'deepseek-chat', messages: [{ role: 'user', content: '你好' }] } })
      .expect(200)
      .expect({ choices: [{ message: { content: 'ok' } }] })

    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/chat/completions', expect.objectContaining({
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test-provider-key' },
    }))
  })

  it('rejects an untrusted destination without making an upstream request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const app = await createTestApp()

    await api(app).post('/api/ai/chat')
      .set('Authorization', 'Bearer sk-test-provider-key')
      .send({ endpoint: 'https://attacker.example/chat/completions', request: { model: 'anything', messages: [] } })
      .expect(400)
      .expect({ error: { message: '不允许代理到该 AI 服务域名' } })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not forward provider credentials across an upstream redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 302, headers: { location: 'https://attacker.example/steal' } })))
    const app = await createTestApp()

    await api(app).post('/api/ai/chat')
      .set('Authorization', 'Bearer sk-test-provider-key')
      .send({ endpoint: 'https://api.deepseek.com/chat/completions', request: { model: 'deepseek-chat', messages: [] } })
      .expect(502)
      .expect({ error: { message: 'AI 服务返回了不安全的重定向' } })
  })
})

describe('account and pairing HTTP API', () => {
  it('serves the web app without masking Nest health and API routes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mindtree-web-nest-test-'))
    temporaryDirectories.push(directory)
    mkdirSync(join(directory, 'assets'))
    writeFileSync(join(directory, 'index.html'), '<!doctype html><title>MindTree</title>')
    const app = await createApp(new DocumentRepository(join(directory, 'mindtree.db')), appOptions, directory)
    const client = request(app.getHttpServer())

    await client.get('/').set('Host', host).expect(200).expect(/MindTree/)
    await client.get('/workspace/map').set('Host', host).expect(200).expect(/MindTree/)
    await client.get('/healthz').set('Host', host).expect(200).expect({ ok: true, service: 'mindtree-server', mcp: '/mcp' })
    await client.get('/api/v1/documents').set('Host', host).expect(401)
  })

  it('accepts one unauthenticated startup diagnostic', async () => {
    const app = await createTestApp()

    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await api(app).post('/api/v1/client-diagnostics').send({ kind: 'boot-timeout', message: '加载超时', asset: '/assets/app.js' }).expect(204)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('[client-diagnostic] kind="boot-timeout"'))
    warning.mockRestore()
  })

  it('registers, logs in, rejects a wrong password, and rejects an expired token', async () => {
    const app = await createTestApp()
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
    const expiredApp = await createApp(repository, appOptions)
    await api(expiredApp).get('/api/v1/documents').set('Authorization', `Bearer ${expired}`).expect(401)
  })

  it('allows a pairing secret to be exchanged once only', async () => {
    const app = await createTestApp()
    const registered = await api(app).post('/api/v1/auth/register').send({ email: 'alice@example.com', password: 'correct horse battery staple' }).expect(201)
    const token = registered.body.token as string
    const pairing = await api(app).post('/api/v1/pairings').set('Authorization', `Bearer ${token}`).send({}).expect(201)

    const payload = { secret: pairing.body.secret as string }
    const firstExchange = await api(app).post(`/api/v1/pairings/${pairing.body.pairingId}/exchange`).send(payload).expect(200)
    expect(firstExchange.body.token).toEqual(expect.any(String))
    await api(app).post(`/api/v1/pairings/${pairing.body.pairingId}/exchange`).send(payload).expect(401)
  })

  it('does not expose one account\'s documents to another account', async () => {
    const app = await createTestApp()
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
