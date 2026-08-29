import { describe, expect, it } from 'vitest'
import { executeCommand } from '@/domain/commands'
import { createInitialDocument } from '@/domain/document.factory'
import { mindMapDocumentSchema } from '@/domain/document.schema'
import { prepareWorkspaceRestore } from '@/export/workspace-backup'

describe('document project assignment', () => {
  it('keeps project ownership as a document-level reversible command', () => {
    const document = createInitialDocument()
    const assigned = executeCommand(document, { type: 'SET_PROJECT', projectId: 'project-algorithm' }).document
    const unassigned = executeCommand(assigned, { type: 'SET_PROJECT', projectId: null }).document

    expect(assigned.projectId).toBe('project-algorithm')
    expect(unassigned.projectId).toBeNull()
  })

  it('migrates old documents without a project id to unassigned', () => {
    const document = createInitialDocument()
    const legacy = structuredClone(document) as Record<string, unknown>
    delete legacy.projectId

    expect(mindMapDocumentSchema.parse(legacy).projectId).toBeNull()
  })

  it('migrates old documents to unpinned by default', () => {
    const legacy = structuredClone(createInitialDocument()) as Record<string, unknown>
    delete legacy.pinned

    expect(mindMapDocumentSchema.parse(legacy).pinned).toBe(false)
  })

  it('migrates old documents into the map content role', () => {
    const legacy = structuredClone(createInitialDocument()) as Record<string, unknown>
    delete legacy.kind

    expect(mindMapDocumentSchema.parse(legacy).kind).toBe('map')
  })

  it('changes a document role through the reversible command layer', () => {
    const document = createInitialDocument()
    const source = executeCommand(document, { type: 'SET_DOCUMENT_KIND', kind: 'source' }).document

    expect(source.kind).toBe('source')
    expect(document.kind).toBe('map')
  })

  it('keeps pinning as a reversible document-level command', () => {
    const document = createInitialDocument()
    const pinned = executeCommand(document, { type: 'SET_PINNED', pinned: true }).document

    expect(pinned.pinned).toBe(true)
    expect(document.pinned).toBe(false)
  })

  it('restores project ownership together with the project library', () => {
    const document = createInitialDocument()
    document.projectId = 'project-algorithm'
    const project = { id: 'project-algorithm', name: '算法刷题计划', description: '', objective: '', status: 'active' as const, pinned: false, createdAt: 1, updatedAt: 1 }
    const plan = prepareWorkspaceRestore({ documents: [document], versions: [], attachments: [], categories: [], projects: [project], tags: [], depositBatches: [], depositProvenance: [], workflowSessions: [] }, {
      documents: [], attachmentIds: new Set(), categories: [], projects: [], tags: [],
    })

    expect(plan.projects).toEqual([project])
    expect(plan.documents[0].projectId).toBe(project.id)
  })
})
