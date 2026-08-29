import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createInitialDocument } from '@/domain/document.factory'
import { ProjectOverviewDialog } from '@/projects/ProjectOverviewDialog'
import type { WorkspaceProject } from '@/projects/project-library'

const project: WorkspaceProject = { id: 'project-1', name: 'MindTree 重构', description: '重构工作区', objective: '形成项目级知识工作台', status: 'active', pinned: false, createdAt: 1, updatedAt: 1 }

describe('ProjectOverviewDialog', () => {
  it('projects content roles, tasks and editable project context without duplicating data', () => {
    const document = createInitialDocument()
    document.id = 'map-1'
    document.projectId = project.id
    document.title = '主导图'
    document.nodes[document.rootId].taskStatus = 'todo'
    const onUpdateProject = vi.fn()
    const onCreateDocument = vi.fn()
    render(<ProjectOverviewDialog project={project} documents={[document]} pendingDepositDocumentIds={new Set([document.id])} onClose={vi.fn()} onUpdateProject={onUpdateProject} onOpenDocument={vi.fn()} onCreateDocument={onCreateDocument} onOpenAgent={vi.fn()} />)

    expect(screen.getByText((_, element) => element?.textContent?.trim() === '1 项待办')).toBeTruthy()
    expect(screen.getByText((_, element) => element?.textContent?.trim() === '1 份待沉淀')).toBeTruthy()
    expect(screen.getAllByText('主导图').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByPlaceholderText('完成这个项目时，应该得到什么结果？'), { target: { value: '完成可验收的大版本' } })
    fireEvent.click(screen.getByRole('button', { name: '保存项目说明' }))
    expect(onUpdateProject).toHaveBeenCalledWith(project, expect.objectContaining({ objective: '完成可验收的大版本' }))

    fireEvent.click(screen.getByRole('button', { name: '新建资料' }))
    expect(onCreateDocument).toHaveBeenCalledWith(project.id, 'source')
  })
})
