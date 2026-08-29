import { useEffect, useMemo, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { ArchiveIcon, ChevronDownIcon, ChevronRightIcon, DrawingPinFilledIcon, DrawingPinIcon, FileTextIcon, MagnifyingGlassIcon, Pencil2Icon, PlusIcon, ReaderIcon, TrashIcon } from '@radix-ui/react-icons'
import { documentKindLabels, documentKinds, type DocumentKind, type MindMapDocument } from '@/domain/document.types'
import { projectStatusLabels, type ProjectStatus, type WorkspaceProject } from '@/projects/project-library'

const expandedProjectsStorageKey = 'mindtree.sidebar-expanded-projects.v2'
const unassignedOpenStorageKey = 'mindtree.sidebar-unassigned-open.v1'

type SmartView = 'inbox' | 'deposit' | 'recent' | 'pinned' | null
type ContextPoint = { x: number; y: number }

type WorkspaceNavigatorProps = {
  projects: WorkspaceProject[]
  documents: MindMapDocument[]
  activeDocumentId: string
  pendingDepositDocumentIds?: ReadonlySet<string>
  query: string
  onQueryChange: (query: string) => void
  onOpenDocument: (document: MindMapDocument) => void
  onOpenProjectOverview: (project: WorkspaceProject) => void
  onAssignProject: (document: MindMapDocument, projectId: string | null) => void
  onSetDocumentKind: (document: MindMapDocument, kind: DocumentKind) => void
  onTogglePinned: (document: MindMapDocument) => void
  onRenameDocument: (document: MindMapDocument) => void
  onDeleteDocument: (document: MindMapDocument) => void
  onDeleteDraft: (document: MindMapDocument) => void
  onCreateProject: () => void
  openTaskCount: number
  onOpenTaskCenter: () => void
  onRenameProject: (project: WorkspaceProject) => void
  onUpdateProject: (project: WorkspaceProject, patch: Partial<Pick<WorkspaceProject, 'status' | 'pinned'>>) => void
  onDeleteProject: (project: WorkspaceProject) => void
  onCreateDocument: (projectId: string | null, kind: DocumentKind) => void
  onImport: () => void
  onRestore: () => void
}

const kindMarks: Record<DocumentKind, string> = { map: '◇', record: '·', source: '↗', output: '✓', knowledge: '※' }

function loadExpandedProjects(): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(expandedProjectsStorageKey) ?? '[]')
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function sortDocuments(documents: MindMapDocument[]): MindMapDocument[] {
  return [...documents].sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt)
}

function menuPoint(event: ReactMouseEvent<HTMLElement>, menuHeight = 420): ContextPoint {
  return { x: Math.max(10, Math.min(event.clientX, window.innerWidth - 244)), y: Math.max(10, Math.min(event.clientY, window.innerHeight - menuHeight)) }
}

function DocumentRow({ document, active, compact = true, projectName, onOpen, onContextMenu, onDragStart, onDragEnd, onTogglePinned, onDeleteDraft }: {
  document: MindMapDocument
  active: boolean
  compact?: boolean
  projectName?: string
  onOpen: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void
  onDragStart: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onTogglePinned: () => void
  onDeleteDraft: () => void
}) {
  return <div className={`workspace-file-row ${active ? 'is-active' : ''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onContextMenu={onContextMenu}>
    <button type="button" className="workspace-file-row__open" onClick={onOpen} title={document.title}>
      <span className={`workspace-file-row__icon is-${document.kind}`} aria-hidden="true">{document.isDraft ? <Pencil2Icon /> : <i>{kindMarks[document.kind]}</i>}</span>
      <span className="workspace-file-row__copy"><strong>{document.title}</strong>{!compact && <small>{projectName ? `${projectName} · ` : ''}{document.isDraft ? '待整理记录' : documentKindLabels[document.kind]}</small>}</span>
    </button>
    {document.isDraft
      ? <button type="button" className="workspace-file-row__action is-delete" onClick={onDeleteDraft} aria-label={`删除记录“${document.title}”`} title="删除记录">×</button>
      : <button type="button" className={`workspace-file-row__action is-pin ${document.pinned ? 'is-pinned' : ''}`} onClick={onTogglePinned} aria-label={`${document.pinned ? '取消置顶' : '置顶'}导图“${document.title}”`} title={document.pinned ? '取消置顶' : '置顶'}>{document.pinned ? <DrawingPinFilledIcon /> : <DrawingPinIcon />}</button>}
  </div>
}

function SmartEntry({ active, mark, label, count, onClick }: { active: boolean; mark: string; label: string; count?: number; onClick: () => void }) {
  return <button type="button" className={`workspace-smart-entry ${active ? 'is-active' : ''}`} onClick={onClick}><span aria-hidden="true">{mark}</span><strong>{label}</strong>{typeof count === 'number' && <small>{count}</small>}</button>
}

export function WorkspaceNavigator({ projects, documents, activeDocumentId, pendingDepositDocumentIds = new Set(), query, onQueryChange, onOpenDocument, onOpenProjectOverview, onAssignProject, onSetDocumentKind, onTogglePinned, onRenameDocument, onDeleteDocument, onDeleteDraft, onCreateProject, openTaskCount, onOpenTaskCenter, onRenameProject, onUpdateProject, onDeleteProject, onCreateDocument, onImport, onRestore }: WorkspaceNavigatorProps) {
  const [expandedProjectIds, setExpandedProjectIds] = useState(loadExpandedProjects)
  const [unassignedOpen, setUnassignedOpen] = useState(() => localStorage.getItem(unassignedOpenStorageKey) === 'true')
  const [completedOpen, setCompletedOpen] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [smartView, setSmartView] = useState<SmartView>(null)
  const [fileMenu, setFileMenu] = useState<{ document: MindMapDocument } & ContextPoint | null>(null)
  const [projectMenu, setProjectMenu] = useState<{ project: WorkspaceProject } & ContextPoint | null>(null)
  const [draggedDocument, setDraggedDocument] = useState<MindMapDocument | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const visibleDocuments = useMemo(() => documents.filter((item) => !normalizedQuery || item.title.toLocaleLowerCase().includes(normalizedQuery)), [documents, normalizedQuery])
  const orderedProjects = [...projects].sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt)
  const activeProjects = orderedProjects.filter((project) => project.status === 'active' || project.status === 'paused')
  const completedProjects = orderedProjects.filter((project) => project.status === 'completed')
  const archivedProjects = orderedProjects.filter((project) => project.status === 'archived')
  const inboxDocuments = sortDocuments(visibleDocuments.filter((item) => item.isDraft))
  const pendingDocuments = sortDocuments(visibleDocuments.filter((item) => pendingDepositDocumentIds.has(item.id)))
  const pinnedDocuments = sortDocuments(visibleDocuments.filter((item) => !item.isDraft && item.pinned))
  const recentDocuments = sortDocuments(visibleDocuments.filter((item) => !item.isDraft)).slice(0, 12)
  const knowledgeDocuments = sortDocuments(visibleDocuments.filter((item) => !item.isDraft && item.kind === 'knowledge'))
  const unassignedDocuments = sortDocuments(visibleDocuments.filter((item) => !item.isDraft && item.projectId === null && item.kind !== 'knowledge'))
  const smartDocuments = smartView === 'inbox' ? inboxDocuments : smartView === 'deposit' ? pendingDocuments : smartView === 'pinned' ? pinnedDocuments : smartView === 'recent' ? recentDocuments : []

  const toggleProject = (projectId: string) => setExpandedProjectIds((current) => {
    const next = new Set(current)
    if (next.has(projectId)) next.delete(projectId); else next.add(projectId)
    localStorage.setItem(expandedProjectsStorageKey, JSON.stringify([...next]))
    return next
  })

  useEffect(() => {
    if (!fileMenu && !projectMenu) return
    const close = () => { setFileMenu(null); setProjectMenu(null) }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close); window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', onKeyDown) }
  }, [fileMenu, projectMenu])

  const beginDrag = (event: ReactDragEvent<HTMLDivElement>, document: MindMapDocument) => {
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-mindtree-document', document.id); setDraggedDocument(document)
  }
  const finishDrag = () => { setDraggedDocument(null); setDropTargetId(null) }
  const allowDrop = (event: ReactDragEvent<HTMLElement>, targetId: string) => {
    if (!draggedDocument || draggedDocument.projectId === targetId) return
    event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; setDropTargetId(targetId)
  }
  const dropInto = (event: ReactDragEvent<HTMLElement>, projectId: string | null) => {
    if (!draggedDocument || draggedDocument.projectId === projectId) return finishDrag()
    event.preventDefault(); onAssignProject(draggedDocument, projectId)
    if (projectId) setExpandedProjectIds((current) => new Set(current).add(projectId))
    finishDrag()
  }

  const renderDocument = (item: MindMapDocument, compact = true, projectName?: string) => <DocumentRow key={item.id} document={item} active={item.id === activeDocumentId} compact={compact} projectName={projectName} onOpen={() => onOpenDocument(item)} onContextMenu={(event) => { event.preventDefault(); setProjectMenu(null); setFileMenu({ document: item, ...menuPoint(event) }) }} onDragStart={(event) => beginDrag(event, item)} onDragEnd={finishDrag} onTogglePinned={() => onTogglePinned(item)} onDeleteDraft={() => onDeleteDraft(item)} />

  const renderProject = (project: WorkspaceProject, lifecycle: ProjectStatus = project.status) => {
    const projectDocuments = sortDocuments(visibleDocuments.filter((item) => item.projectId === project.id))
    const open = normalizedQuery ? projectDocuments.length > 0 : expandedProjectIds.has(project.id)
    const archived = lifecycle === 'archived'
    return <section className={`workspace-project ${open ? 'is-open' : ''} ${dropTargetId === project.id ? 'is-drop-target' : ''}`} key={project.id} aria-label={project.name} onDragOver={archived ? undefined : (event) => allowDrop(event, project.id)} onDragLeave={() => { if (dropTargetId === project.id) setDropTargetId(null) }} onDrop={archived ? undefined : (event) => dropInto(event, project.id)}>
      <div className="workspace-project__heading">
        <button type="button" className="workspace-project__toggle" onClick={() => toggleProject(project.id)} onContextMenu={(event) => { event.preventDefault(); setFileMenu(null); setProjectMenu({ project, ...menuPoint(event, 360) }) }} aria-expanded={open} title={project.objective || project.description || project.name}>
          <span className="workspace-project__chevron" aria-hidden="true">{open ? <ChevronDownIcon /> : <ChevronRightIcon />}</span><span className={`workspace-project__folder is-${project.status}`} aria-hidden="true"><ArchiveIcon /></span><strong>{project.name}</strong><small>{projectDocuments.length}</small>
        </button>
        {!archived && <button type="button" className="workspace-project__add" onClick={() => onCreateDocument(project.id, 'map')} aria-label={`在“${project.name}”新建导图`} title="新建导图"><PlusIcon /></button>}
      </div>
      {open && <div className="workspace-project__contents">
        <button type="button" className="workspace-project-overview-entry" onClick={() => onOpenProjectOverview(project)}><span>◎</span><strong>项目总览</strong><small>{projectStatusLabels[project.status]}</small></button>
        {documentKinds.filter((kind) => kind !== 'knowledge').map((kind) => {
          const items = projectDocuments.filter((item) => item.kind === kind)
          if (!items.length) return null
          return <section className="workspace-kind-group" key={kind} aria-label={`${project.name}的${documentKindLabels[kind]}`}><header><span>{kindMarks[kind]}</span><strong>{documentKindLabels[kind]}</strong><small>{items.length}</small></header>{items.map((item) => renderDocument(item))}</section>
        })}
        {!projectDocuments.length && !archived && <button type="button" className="workspace-project__empty" onClick={() => onCreateDocument(project.id, 'map')}><PlusIcon />创建第一张导图</button>}
      </div>}
    </section>
  }

  const toggleSmartView = (view: Exclude<SmartView, null>) => setSmartView((current) => current === view ? null : view)

  return <nav className="workspace-navigator" aria-label="工作区导航">
    <label className="workspace-navigator__search"><MagnifyingGlassIcon /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索项目与内容…" aria-label="搜索项目与内容" /></label>

    <section className="workspace-smart" aria-label="工作台">
      <header className="workspace-navigator__label"><span><ReaderIcon />工作台</span></header>
      <SmartEntry active={smartView === 'inbox'} mark="↓" label="收件箱" count={inboxDocuments.length} onClick={() => toggleSmartView('inbox')} />
      <SmartEntry active={smartView === 'deposit'} mark="✦" label="待沉淀" count={pendingDocuments.length} onClick={() => toggleSmartView('deposit')} />
      <SmartEntry active={smartView === 'recent'} mark="◷" label="最近" onClick={() => toggleSmartView('recent')} />
      <SmartEntry active={smartView === 'pinned'} mark="⌁" label="置顶" count={pinnedDocuments.length} onClick={() => toggleSmartView('pinned')} />
      <SmartEntry active={false} mark="✓" label="任务中心" count={openTaskCount} onClick={onOpenTaskCenter} />
      {smartView && <div className="workspace-smart-results" aria-label={`${smartView}内容`}>{smartDocuments.length ? smartDocuments.map((item) => renderDocument(item, false, projects.find((project) => project.id === item.projectId)?.name)) : <p>这里暂时没有内容</p>}</div>}
    </section>

    <section className="workspace-navigator__section" aria-label="项目">
      <header className="workspace-navigator__label"><span><ArchiveIcon />项目</span><button type="button" onClick={onCreateProject} aria-label="新建项目" title="新建项目"><PlusIcon /></button></header>
      <div className="workspace-project-list">{activeProjects.map((project) => renderProject(project))}{!activeProjects.length && <button type="button" className="workspace-project-list__empty" onClick={onCreateProject}><ArchiveIcon /><span><strong>创建第一个项目</strong><small>把导图、记录和资料收在同一处</small></span></button>}</div>
    </section>

    <section className="workspace-navigator__section workspace-knowledge" aria-label="知识库">
      <header className="workspace-navigator__label"><span><FileTextIcon />知识库</span><button type="button" onClick={() => onCreateDocument(null, 'knowledge')} aria-label="新建知识"><PlusIcon /></button></header>
      {knowledgeDocuments.slice(0, 8).map((item) => renderDocument(item))}{!knowledgeDocuments.length && <button type="button" className="workspace-project__empty" onClick={() => onCreateDocument(null, 'knowledge')}><PlusIcon />沉淀第一条长期知识</button>}
    </section>

    {completedProjects.length > 0 && <section className="workspace-navigator__section workspace-lifecycle" aria-label="已完成项目"><button type="button" className="workspace-archive-toggle" onClick={() => setCompletedOpen((current) => !current)} aria-expanded={completedOpen}><span>{completedOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}</span><strong>已完成项目</strong><small>{completedProjects.length}</small></button>{completedOpen && <div className="workspace-project-list workspace-project-list--archived">{completedProjects.map((project) => renderProject(project, 'completed'))}</div>}</section>}
    {archivedProjects.length > 0 && <section className="workspace-navigator__section workspace-lifecycle" aria-label="已归档项目"><button type="button" className="workspace-archive-toggle" onClick={() => setArchivedOpen((current) => !current)} aria-expanded={archivedOpen}><span>{archivedOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}</span><strong>已归档项目</strong><small>{archivedProjects.length}</small></button>{archivedOpen && <div className="workspace-project-list workspace-project-list--archived">{archivedProjects.map((project) => renderProject(project, 'archived'))}</div>}</section>}

    <section className={`workspace-navigator__section workspace-unassigned ${unassignedOpen || normalizedQuery ? 'is-open' : ''} ${dropTargetId === 'unassigned' ? 'is-drop-target' : ''}`} aria-label="未归属内容" onDragOver={(event) => allowDrop(event, 'unassigned')} onDragLeave={() => setDropTargetId(null)} onDrop={(event) => dropInto(event, null)}>
      <div className="workspace-unassigned__heading"><button type="button" className="workspace-unassigned__toggle" onClick={() => { setUnassignedOpen((current) => { localStorage.setItem(unassignedOpenStorageKey, String(!current)); return !current }) }} aria-expanded={unassignedOpen || Boolean(normalizedQuery)}><span>{unassignedOpen || normalizedQuery ? <ChevronDownIcon /> : <ChevronRightIcon />}</span><ReaderIcon /><strong>未归属内容</strong><small>{unassignedDocuments.length}</small></button><button type="button" className="workspace-project__add" onClick={() => onCreateDocument(null, 'map')} aria-label="新建未归属导图"><PlusIcon /></button></div>
      {(unassignedOpen || Boolean(normalizedQuery)) && <div className="workspace-unassigned__contents" tabIndex={unassignedDocuments.length > 8 ? 0 : undefined}>{unassignedDocuments.map((item) => renderDocument(item))}{!unassignedDocuments.length && <p>没有未归属内容</p>}</div>}
    </section>

    <div className="workspace-navigator__utilities"><button type="button" onClick={onImport}>导入内容</button><button type="button" onClick={onRestore}>恢复备份</button></div>

    {fileMenu && <div className="workspace-file-context-menu" role="menu" aria-label={`整理“${fileMenu.document.title}”`} style={{ '--context-menu-x': `${fileMenu.x}px`, '--context-menu-y': `${fileMenu.y}px` } as CSSProperties} onClick={(event) => event.stopPropagation()}>
      <header><strong>{fileMenu.document.title}</strong><small>{documentKindLabels[fileMenu.document.kind]}</small></header>
      {!fileMenu.document.isDraft && <button type="button" onClick={() => { onRenameDocument(fileMenu.document); setFileMenu(null) }}><Pencil2Icon />重命名</button>}
      <span className="workspace-file-context-menu__divider" /><p className="workspace-file-context-menu__label">内容类型</p>
      {documentKinds.map((kind) => <button type="button" key={kind} className={fileMenu.document.kind === kind ? 'is-current' : ''} disabled={fileMenu.document.kind === kind} onClick={() => { onSetDocumentKind(fileMenu.document, kind); setFileMenu(null) }}><span>{kindMarks[kind]}</span>{documentKindLabels[kind]}</button>)}
      <span className="workspace-file-context-menu__divider" /><p className="workspace-file-context-menu__label">移动到项目</p>
      <button type="button" disabled={fileMenu.document.projectId === null} onClick={() => { onAssignProject(fileMenu.document, null); setFileMenu(null) }}><ReaderIcon />未归属</button>
      {activeProjects.map((project) => <button type="button" key={project.id} disabled={fileMenu.document.projectId === project.id} className={fileMenu.document.projectId === project.id ? 'is-current' : ''} onClick={() => { onAssignProject(fileMenu.document, project.id); setFileMenu(null) }}><ArchiveIcon />{project.name}</button>)}
      {!fileMenu.document.isDraft && <><span className="workspace-file-context-menu__divider" /><button type="button" onClick={() => { onTogglePinned(fileMenu.document); setFileMenu(null) }}>{fileMenu.document.pinned ? <DrawingPinFilledIcon /> : <DrawingPinIcon />}{fileMenu.document.pinned ? '取消置顶' : '置顶'}</button><button type="button" className="is-danger" onClick={() => { onDeleteDocument(fileMenu.document); setFileMenu(null) }}><TrashIcon />删除</button></>}
    </div>}

    {projectMenu && <div className="workspace-file-context-menu workspace-project-context-menu" role="menu" aria-label={`项目“${projectMenu.project.name}”操作`} style={{ '--context-menu-x': `${projectMenu.x}px`, '--context-menu-y': `${projectMenu.y}px` } as CSSProperties} onClick={(event) => event.stopPropagation()}>
      <header><strong>{projectMenu.project.name}</strong><small>{projectStatusLabels[projectMenu.project.status]}</small></header>
      <button type="button" onClick={() => { onOpenProjectOverview(projectMenu.project); setProjectMenu(null) }}>◎ 项目总览</button>
      {projectMenu.project.status !== 'archived' && <button type="button" onClick={() => { onCreateDocument(projectMenu.project.id, 'map'); setProjectMenu(null) }}><PlusIcon />新建导图</button>}
      <button type="button" onClick={() => { onRenameProject(projectMenu.project); setProjectMenu(null) }}><Pencil2Icon />重命名项目</button>
      <button type="button" onClick={() => { onUpdateProject(projectMenu.project, { pinned: !projectMenu.project.pinned }); setProjectMenu(null) }}>{projectMenu.project.pinned ? <DrawingPinFilledIcon /> : <DrawingPinIcon />}{projectMenu.project.pinned ? '取消置顶项目' : '置顶项目'}</button>
      <span className="workspace-file-context-menu__divider" /><p className="workspace-file-context-menu__label">项目状态</p>
      {(['active', 'paused', 'completed', 'archived'] as ProjectStatus[]).map((status) => <button type="button" key={status} disabled={projectMenu.project.status === status} className={projectMenu.project.status === status ? 'is-current' : ''} onClick={() => { onUpdateProject(projectMenu.project, { status }); setProjectMenu(null) }}>{projectStatusLabels[status]}</button>)}
      <span className="workspace-file-context-menu__divider" /><button type="button" className="is-danger" onClick={() => { onDeleteProject(projectMenu.project); setProjectMenu(null) }}><TrashIcon />删除项目</button>
    </div>}
  </nav>
}
