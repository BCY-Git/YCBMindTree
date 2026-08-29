import { useEffect, useMemo, useState } from 'react'
import { Cross2Icon, MagicWandIcon, PlusIcon } from '@radix-ui/react-icons'
import { documentKindLabels, documentKinds, type DocumentKind, type MindMapDocument } from '@/domain/document.types'
import { collectTasks } from '@/tasks/task-index'
import { projectStatusLabels, projectStatuses, type WorkspaceProject } from './project-library'

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)
}

export function ProjectOverviewDialog({ project, documents, pendingDepositDocumentIds, onClose, onUpdateProject, onOpenDocument, onCreateDocument, onOpenAgent }: {
  project: WorkspaceProject
  documents: MindMapDocument[]
  pendingDepositDocumentIds: ReadonlySet<string>
  onClose: () => void
  onUpdateProject: (project: WorkspaceProject, patch: Partial<WorkspaceProject>) => void
  onOpenDocument: (document: MindMapDocument) => void
  onCreateDocument: (projectId: string, kind: DocumentKind) => void
  onOpenAgent: (project: WorkspaceProject) => void
}) {
  const [objective, setObjective] = useState(project.objective)
  const [description, setDescription] = useState(project.description)
  useEffect(() => { setObjective(project.objective); setDescription(project.description) }, [project])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  const projectDocuments = useMemo(() => documents.filter((document) => document.projectId === project.id).sort((left, right) => right.updatedAt - left.updatedAt), [documents, project.id])
  const tasks = useMemo(() => collectTasks(projectDocuments), [projectDocuments])
  const openTasks = tasks.filter((task) => task.status !== 'done')
  const completedTasks = tasks.filter((task) => task.status === 'done')
  const pendingCount = projectDocuments.filter((document) => pendingDepositDocumentIds.has(document.id)).length
  const dirty = objective.trim() !== project.objective || description.trim() !== project.description

  const saveOverview = () => {
    if (!dirty) return
    onUpdateProject(project, { objective: objective.trim(), description: description.trim() })
  }

  return <div className="project-overview-layer" role="dialog" aria-modal="true" aria-labelledby="project-overview-title" onMouseDown={onClose}>
    <section className="project-overview" onMouseDown={(event) => event.stopPropagation()}>
      <header className="project-overview__header">
        <div><p>项目总览</p><h2 id="project-overview-title">{project.name}</h2></div>
        <div className="project-overview__header-actions"><button type="button" className="project-overview__agent" onClick={() => onOpenAgent(project)}><MagicWandIcon />项目 Agent</button><button type="button" className="project-overview__close" onClick={onClose} aria-label="关闭项目总览"><Cross2Icon /></button></div>
      </header>

      <div className="project-overview__statusbar">
        <label>状态<select value={project.status} onChange={(event) => onUpdateProject(project, { status: event.target.value as WorkspaceProject['status'] })}>{projectStatuses.map((status) => <option key={status} value={status}>{projectStatusLabels[status]}</option>)}</select></label>
        <span><strong>{projectDocuments.length}</strong> 项内容</span><span><strong>{openTasks.length}</strong> 项待办</span><span><strong>{completedTasks.length}</strong> 项完成</span><span className={pendingCount ? 'has-pending' : ''}><strong>{pendingCount}</strong> 份待沉淀</span>
      </div>

      <div className="project-overview__body">
        <section className="project-overview__brief">
          <label><span>结果定义</span><textarea rows={3} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="完成这个项目时，应该得到什么结果？" /></label>
          <label><span>背景与范围</span><textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="记录项目背景、边界和关键约束。" /></label>
          <button type="button" onClick={saveOverview} disabled={!dirty}>保存项目说明</button>
        </section>

        <section className="project-overview__activity" aria-label="最近活动">
          <header><div><p>最近活动</p><h3>继续工作的入口</h3></div></header>
          {projectDocuments.length ? <div>{projectDocuments.slice(0, 7).map((document) => <button type="button" key={document.id} onClick={() => onOpenDocument(document)}><span className={`is-${document.kind}`}>{document.kind === 'map' ? '◇' : document.kind === 'record' ? '·' : document.kind === 'source' ? '↗' : document.kind === 'output' ? '✓' : '※'}</span><strong>{document.title}</strong><small>{documentKindLabels[document.kind]} · {formatDate(document.updatedAt)}</small></button>)}</div> : <p className="project-overview__empty">项目中还没有内容。</p>}
        </section>

        <section className="project-overview__library" aria-label="项目资料结构">
          <header><div><p>项目内容</p><h3>按工作角色组织</h3></div></header>
          <div>{documentKinds.filter((kind) => kind !== 'knowledge').map((kind) => {
            const items = projectDocuments.filter((document) => document.kind === kind)
            return <section key={kind}><div><strong>{documentKindLabels[kind]}</strong><small>{items.length}</small><button type="button" onClick={() => onCreateDocument(project.id, kind)} aria-label={`新建${documentKindLabels[kind]}`}><PlusIcon /></button></div>{items.slice(0, 4).map((document) => <button type="button" key={document.id} onClick={() => onOpenDocument(document)}>{document.title}</button>)}{!items.length && <p>暂无内容</p>}</section>
          })}</div>
        </section>

        <section className="project-overview__next" aria-label="下一步">
          <header><p>下一步</p><h3>{openTasks.length ? `${openTasks.length} 项任务仍需推进` : '当前没有未完成任务'}</h3></header>
          {openTasks.length ? <ul>{openTasks.slice(0, 6).map((task) => <li key={`${task.documentId}:${task.nodeId}`}><span className={`is-${task.status}`} /> <strong>{task.topic}</strong><small>{projectDocuments.find((document) => document.id === task.documentId)?.title}</small></li>)}</ul> : <p>可以继续记录过程，或让项目 Agent 检查遗漏与下一步。</p>}
        </section>
      </div>
    </section>
  </div>
}
