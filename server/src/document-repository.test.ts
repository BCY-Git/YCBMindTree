import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DOCUMENT_CHANGE_RETENTION, DocumentRepository } from './document-repository.js'

const temporaryDirectories: string[] = []

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'mindtree-server-test-'))
  temporaryDirectories.push(directory)
  return new DocumentRepository(join(directory, 'mindtree.db'))
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
})

describe('account sessions and document ownership', () => {
  it('creates the first account as the legacy owner and authenticates only the correct password', () => {
    const repository = createRepository()
    const user = repository.registerAccount('Owner@Example.com', 'correct horse battery staple')!

    expect(user).toMatchObject({ id: 'local-user', email: 'owner@example.com' })
    expect(repository.authenticateAccount('owner@example.com', 'wrong password')).toBeNull()
    expect(repository.authenticateAccount('OWNER@example.com', 'correct horse battery staple')).toMatchObject({ id: 'local-user' })
    expect(repository.registerAccount('owner@example.com', 'another valid password')).toBeNull()
  })

  it('issues expiring opaque sessions without accepting expired tokens', () => {
    const repository = createRepository()
    const user = repository.registerAccount('owner@example.com', 'correct horse battery staple')!
    const token = repository.createSession(user.id, 60_000)
    const expiredToken = repository.createSession(user.id, -1)

    expect(repository.sessionOwner(token)).toBe(user.id)
    expect(repository.sessionOwner(expiredToken)).toBeNull()
    repository.revokeSession(token)
    expect(repository.sessionOwner(token)).toBeNull()
  })

  it('keeps documents inaccessible across account owners', () => {
    const repository = createRepository()
    const alice = repository.registerAccount('alice@example.com', 'correct horse battery staple')!
    const bob = repository.registerAccount('bob@example.com', 'correct horse battery staple')!
    const documentId = 'account-owned-document'
    repository.save({ id: documentId, ownerId: alice.id, title: 'Alice 私有导图', categoryId: 'uncategorized', payload: { nodes: {} }, baseVersion: 0 })

    expect(repository.get(alice.id, documentId)?.title).toBe('Alice 私有导图')
    expect(repository.get(bob.id, documentId)).toBeUndefined()
    expect(repository.list(bob.id)).toEqual([])
    expect(() => repository.save({ id: documentId, ownerId: bob.id, title: '越权写入', categoryId: 'uncategorized', payload: {}, baseVersion: 1 })).toThrow('无权访问')
  })

  it('claims a pairing code once for the originating account', () => {
    const repository = createRepository()
    const user = repository.registerAccount('owner@example.com', 'correct horse battery staple')!
    const challenge = repository.createPairingChallenge(user.id)

    expect(repository.claimPairingChallenge(challenge.id, challenge.secret)).toBe(user.id)
    expect(repository.claimPairingChallenge(challenge.id, challenge.secret)).toBeNull()
  })

  it('retains only the newest document changes for each document', () => {
    const repository = createRepository()
    const owner = repository.registerAccount('owner@example.com', 'correct horse battery staple')!
    const documentId = 'bounded-history-document'

    for (let version = 0; version < DOCUMENT_CHANGE_RETENTION + 5; version += 1) {
      const saved = repository.save({
        id: documentId,
        ownerId: owner.id,
        title: `版本 ${version + 1}`,
        categoryId: 'uncategorized',
        payload: { version },
        baseVersion: version,
      })
      expect('type' in saved).toBe(false)
    }

    expect(repository.changeCount(documentId)).toBe(DOCUMENT_CHANGE_RETENTION)
    expect(repository.get(owner.id, documentId)?.version).toBe(DOCUMENT_CHANGE_RETENTION + 5)
  })

  it('persists MCP deposit previews per owner without exposing another account batch', () => {
    const repository = createRepository()
    const batch = { id: 'batch-1', ownerId: 'owner-1', sourceDocumentId: 'document-1', sourceNodeIds: ['source-1'], targetDocumentId: 'document-1', expectedVersion: 1, status: 'pending' as const, candidates: [], changes: [], confirmationToken: 'secret-token', createdAt: 1_000, appliedAt: null }

    repository.saveMcpDepositBatch(batch)

    expect(repository.listMcpDepositBatches('owner-1')).toEqual([batch])
    expect(repository.listMcpDepositBatches('owner-2')).toEqual([])
  })
})
