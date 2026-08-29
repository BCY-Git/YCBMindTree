import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceNavigator } from '@/app/WorkspaceNavigator'
import { createInitialDocument, createQuickNoteDocument } from '@/domain/document.factory'
import type { MindMapDocument } from '@/domain/document.types'
import type { WorkspaceProject } from '@/projects/project-library'

const project: WorkspaceProject = { id: 'project-alpha', name: '阿尔法项目', description: '', objective: '', status: 'active', pinned: false, createdAt: 1, updatedAt: 1 }

function map(title: string, projectId: string | null, pinned = false): MindMapDocument {
  return { ...createInitialDocument(), id: `map-${title}`, title, projectId, pinned, updatedAt: 10 }
}

function renderNavigator(documents: MindMapDocument[]) {
  const onAssignProject = vi.fn()
  const onTogglePinned = vi.fn()
  const onSetDocumentKind = vi.fn()
  const onRenameDocument = vi.fn()
  const onDeleteDocument = vi.fn()
  const onRenameProject = vi.fn()
  const onUpdateProject = vi.fn()
  const onDeleteProject = vi.fn()
  const result = render(<WorkspaceNavigator
    projects={[project]}
    documents={documents}
    activeDocumentId={documents[0].id}
    query=""
    onQueryChange={vi.fn()}
    onOpenDocument={vi.fn()}
    onOpenProjectOverview={vi.fn()}
    onAssignProject={onAssignProject}
    onSetDocumentKind={onSetDocumentKind}
    onTogglePinned={onTogglePinned}
    onRenameDocument={onRenameDocument}
    onDeleteDocument={onDeleteDocument}
    onDeleteDraft={vi.fn()}
    onCreateProject={vi.fn()}
    openTaskCount={0}
    onOpenTaskCenter={vi.fn()}
    onRenameProject={onRenameProject}
    onUpdateProject={onUpdateProject}
    onDeleteProject={onDeleteProject}
    onCreateDocument={vi.fn()}
    onImport={vi.fn()}
    onRestore={vi.fn()}
  />)
  return { ...result, onAssignProject, onSetDocumentKind, onTogglePinned, onRenameDocument, onDeleteDocument, onRenameProject, onUpdateProject, onDeleteProject }
}

describe('WorkspaceNavigator', () => {
  beforeEach(() => localStorage.clear())

  it('默认折叠未归属内容，并可按需展开', () => {
    renderNavigator([map('游离导图', null)])

    const toggle = screen.getAllByRole('button', { name: /未归属内容/ }).find((button) => button.hasAttribute('aria-expanded'))!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('游离导图')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('游离导图')).not.toBeNull()
    expect(localStorage.getItem('mindtree.sidebar-unassigned-open.v1')).toBe('true')
  })

  it('将大量未归属导图限制在可键盘聚焦的独立列表中', () => {
    const documents = Array.from({ length: 100 }, (_, index) => map(`游离导图 ${index + 1}`, null))
    const { container } = renderNavigator(documents)

    const toggle = screen.getAllByRole('button', { name: /未归属内容/ }).find((button) => button.hasAttribute('aria-expanded'))!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)

    const contents = container.querySelector('.workspace-unassigned__contents')
    expect(contents?.getAttribute('tabindex')).toBe('0')
    expect(contents?.querySelectorAll('.workspace-file-row')).toHaveLength(100)
  })

  it('在项目文件夹中同时展示导图和记录', () => {
    const projectMap = map('方案导图', project.id)
    const record = { ...createQuickNoteDocument(), id: 'record-1', title: '评审记录', projectId: project.id }
    renderNavigator([projectMap, record])

    const projectToggle = screen.getAllByRole('button', { name: /阿尔法项目/ }).find((button) => button.hasAttribute('aria-expanded'))!
    fireEvent.click(projectToggle)
    expect(screen.getByText('方案导图')).not.toBeNull()
    expect(screen.getByText('评审记录')).not.toBeNull()
    expect(screen.getByRole('button', { name: '删除记录“评审记录”' })).not.toBeNull()
  })

  it('可从导图行置顶，并在置顶区显示已置顶导图', () => {
    const normal = map('普通导图', project.id)
    const pinned = map('常用导图', project.id, true)
    const { onTogglePinned } = renderNavigator([normal, pinned])

    fireEvent.click(screen.getByRole('button', { name: '置顶 1' }))
    expect(screen.getByLabelText('pinned内容').textContent).toContain('常用导图')
    fireEvent.click(screen.getByRole('button', { name: '取消置顶导图“常用导图”' }))
    expect(onTogglePinned).toHaveBeenCalledWith(pinned)
  })

  it('右键导图可直接移至项目或移回未归属', () => {
    const projectMap = map('待整理导图', project.id)
    const { onAssignProject } = renderNavigator([projectMap])

    const projectToggle = screen.getAllByRole('button', { name: /阿尔法项目/ }).find((button) => button.hasAttribute('aria-expanded'))!
    fireEvent.click(projectToggle)
    fireEvent.contextMenu(screen.getByText('待整理导图'), { clientX: 48, clientY: 96 })

    expect(screen.getByRole('menu', { name: '整理“待整理导图”' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '未归属' }))
    expect(onAssignProject).toHaveBeenCalledWith(projectMap, null)
    expect(screen.queryByRole('menu', { name: '整理“待整理导图”' })).toBeNull()
  })

  it('右键内容可切换为资料并进入固定项目分类', () => {
    const projectMap = map('研究材料', project.id)
    const { onSetDocumentKind } = renderNavigator([projectMap])
    const projectToggle = screen.getAllByRole('button', { name: /阿尔法项目/ }).find((button) => button.hasAttribute('aria-expanded'))!
    fireEvent.click(projectToggle)
    fireEvent.contextMenu(screen.getByText('研究材料'), { clientX: 48, clientY: 96 })
    fireEvent.click(screen.getByRole('button', { name: '↗ 资料' }))

    expect(onSetDocumentKind).toHaveBeenCalledWith(projectMap, 'source')
  })

  it('可拖动未归属导图放入项目文件夹', () => {
    const looseMap = map('待归档导图', null)
    const { onAssignProject } = renderNavigator([looseMap])
    const unassignedToggle = screen.getAllByRole('button', { name: /未归属内容/ }).find((button) => button.hasAttribute('aria-expanded'))!
    fireEvent.click(unassignedToggle)
    const row = screen.getByText('待归档导图').closest('.workspace-file-row')!
    const projectFolder = screen.getAllByRole('button', { name: /阿尔法项目/ }).find((button) => button.hasAttribute('aria-expanded'))!

    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } })
    fireEvent.dragOver(projectFolder)
    fireEvent.drop(projectFolder)
    expect(onAssignProject).toHaveBeenCalledWith(looseMap, project.id)
  })

  it('右键项目文件夹可新建、归档或删除项目', () => {
    const { onUpdateProject, onDeleteProject } = renderNavigator([map('方案导图', project.id)])
    const projectFolder = screen.getAllByRole('button', { name: /阿尔法项目/ }).find((button) => button.hasAttribute('aria-expanded'))!
    fireEvent.contextMenu(projectFolder, { clientX: 48, clientY: 96 })

    expect(screen.getByRole('menu', { name: '项目“阿尔法项目”操作' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '已归档' }))
    expect(onUpdateProject).toHaveBeenCalledWith(project, { status: 'archived' })
    fireEvent.contextMenu(projectFolder, { clientX: 48, clientY: 96 })
    fireEvent.click(screen.getByRole('button', { name: '删除项目' }))
    expect(onDeleteProject).toHaveBeenCalledWith(project)
  })
})
