import { useMemo } from 'react'
import type { MindMapDocument } from '@/domain/document.types'
import { collectTasks } from '@/tasks/task-index'
import type { WorkspaceProject } from './project-library'

type ProjectPlan = {
  project: WorkspaceProject
  documents: MindMapDocument[]
  openTasks: number
  completedTasks: number
}

function formatUpdatedAt(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp)
}

/** 计划是只读投影：项目、导图和任务始终只在各自的原始位置保存。 */
export function PlanCenterDialog({ projects, documents, onClose, onOpenDocument, onCreateDocument }: {
  projects: WorkspaceProject[]
  documents: MindMapDocument[]
  onClose: () => void
  onOpenDocument: (document: MindMapDocument) => void
  onCreateDocument: (projectId: string) => void
}) {
  const plans = useMemo<ProjectPlan[]>(() => projects.map((project) => {
    const projectDocuments = documents.filter((document) => document.projectId === project.id && !document.isDraft)
    const tasks = collectTasks(projectDocuments)
    return {
      project,
      documents: projectDocuments,
      openTasks: tasks.filter((task) => task.status !== 'done').length,
      completedTasks: tasks.filter((task) => task.status === 'done').length,
    }
  }), [documents, projects])

  return <div className="plan-center-layer" role="dialog" aria-modal="true" aria-labelledby="plan-center-title" onMouseDown={onClose}>
    <section className="plan-center" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><p className="eyebrow">计划</p><h2 id="plan-center-title">项目计划</h2><p>按项目查看思维树与待办，不复制任何任务数据。</p></div>
        <button type="button" onClick={onClose} aria-label="关闭计划">×</button>
      </header>
      <div className="plan-center__list">
        {plans.length ? plans.map(({ project, documents: projectDocuments, openTasks, completedTasks }) => <article key={project.id}>
          <div className="plan-center__project-head">
            <div><strong>{project.name}</strong>{project.description && <p>{project.description}</p>}</div>
            <button type="button" onClick={() => onCreateDocument(project.id)}>新建导图</button>
          </div>
          <div className="plan-center__metrics"><span>{projectDocuments.length} 张导图</span><span>{openTasks} 项待办</span><span>{completedTasks} 项完成</span></div>
          {projectDocuments.length ? <div className="plan-center__maps">{projectDocuments.slice(0, 4).map((document) => <button key={document.id} type="button" onClick={() => onOpenDocument(document)}><span>◈</span><strong>{document.title}</strong><small>更新于 {formatUpdatedAt(document.updatedAt)}</small></button>)}</div> : <p className="plan-center__empty">还没有导图。从这里新建第一棵思维树。</p>}
        </article>) : <div className="plan-center__blank"><strong>还没有项目计划</strong><p>先在左侧“项目”中新建项目，再把导图归属到它。</p></div>}
      </div>
    </section>
  </div>
}
