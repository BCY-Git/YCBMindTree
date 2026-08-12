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

  it('restores project ownership together with the project library', () => {
    const document = createInitialDocument()
    document.projectId = 'project-algorithm'
    const project = { id: 'project-algorithm', name: '算法刷题计划', description: '', createdAt: 1, updatedAt: 1 }
    const plan = prepareWorkspaceRestore({ documents: [document], versions: [], attachments: [], categories: [], projects: [project], tags: [], depositBatches: [], depositProvenance: [], workflowSessions: [] }, {
      documents: [], attachmentIds: new Set(), categories: [], projects: [], tags: [],
    })

    expect(plan.projects).toEqual([project])
    expect(plan.documents[0].projectId).toBe(project.id)
  })
})
