import { randomUuid } from '@/platform/random-uuid'

export const projectStatuses = ['active', 'paused', 'completed', 'archived'] as const
export type ProjectStatus = typeof projectStatuses[number]

export const projectStatusLabels: Record<ProjectStatus, string> = {
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
}

/** 项目是资料、记录、导图与 Agent 的上下文边界；内容仍通过 projectId 建立唯一主归属。 */
export type WorkspaceProject = {
  id: string
  name: string
  description: string
  /** 比简介更稳定的结果定义；旧项目默认沿用 description。 */
  objective: string
  status: ProjectStatus
  pinned: boolean
  createdAt: number
  updatedAt: number
}

const storageKey = 'mindtree.projects.v1'

type StoredProject = Partial<WorkspaceProject> & { archived?: boolean }

function isStoredProject(value: unknown): value is StoredProject {
  if (!value || typeof value !== 'object') return false
  const item = value as StoredProject
  return typeof item.id === 'string' && Boolean(item.id)
    && typeof item.name === 'string' && Boolean(item.name.trim())
    && typeof item.description === 'string'
    && (item.objective === undefined || typeof item.objective === 'string')
    && (item.status === undefined || projectStatuses.includes(item.status))
    && (item.pinned === undefined || typeof item.pinned === 'boolean')
    && (item.archived === undefined || typeof item.archived === 'boolean')
    && typeof item.createdAt === 'number'
    && typeof item.updatedAt === 'number'
}

/** 统一处理 localStorage 与工作区备份中的旧版项目。 */
export function normalizeProject(project: StoredProject): WorkspaceProject {
  const description = project.description?.trim() ?? ''
  return {
    id: project.id!,
    name: project.name!.trim(),
    description,
    objective: project.objective?.trim() || description,
    status: project.status ?? (project.archived ? 'archived' : 'active'),
    pinned: project.pinned ?? false,
    createdAt: project.createdAt!,
    updatedAt: project.updatedAt!,
  }
}

export function loadProjects(): WorkspaceProject[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(stored)) return []
    return stored
      .filter(isStoredProject)
      .map(normalizeProject)
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt)
  } catch {
    return []
  }
}

export function saveProjects(projects: WorkspaceProject[]): void {
  localStorage.setItem(storageKey, JSON.stringify(projects))
}

export function createProject(name: string, description = ''): WorkspaceProject {
  const now = Date.now()
  return {
    id: `project-${randomUuid()}`,
    name: name.trim() || '未命名项目',
    description: description.trim(),
    objective: description.trim(),
    status: 'active',
    pinned: false,
    createdAt: now,
    updatedAt: now,
  }
}
