import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { attachWebHost } from './web-host.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
})

describe('MindTree web host', () => {
  it('serves the built web app and keeps API misses as API responses', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mindtree-web-host-'))
    temporaryDirectories.push(directory)
    mkdirSync(join(directory, 'assets'))
    writeFileSync(join(directory, 'index.html'), '<!doctype html><title>MindTree</title>')
    writeFileSync(join(directory, 'assets', 'app.js'), 'console.log("mindtree")')
    const app = express()
    app.get('/api/v1/ping', (_request, response) => response.json({ ok: true }))
    attachWebHost(app, directory)

    await request(app).get('/').expect(200).expect('content-type', /text\/html/).expect('cache-control', /no-store/).expect(/MindTree/)
    await request(app).get('/workspace/map').expect(200).expect(/MindTree/)
    await request(app).get('/assets/app.js').expect(200).expect('cache-control', /immutable/)
    await request(app).get('/assets/missing.js').expect(404)
    await request(app).get('/api/v1/missing').expect(404)
  })

  it('fails fast when the configured build directory is missing', () => {
    expect(() => attachWebHost(express(), '/definitely/missing/mindtree-web-root')).toThrow('网页入口不存在')
  })
})
