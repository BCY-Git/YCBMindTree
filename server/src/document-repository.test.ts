import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentRepository } from './document-repository.js'

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
})
