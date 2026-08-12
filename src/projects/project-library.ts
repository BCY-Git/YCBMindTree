import { randomUuid } from '@/platform/random-uuid'

/** 工作区项目只保存组织信息；导图通过 projectId 建立归属。 */
export type WorkspaceProject = {
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
}

const storageKey = 'mindtree.projects.v1'

function isProject(value: unknown): value is WorkspaceProject {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<WorkspaceProject>
  return typeof item.id === 'string' && Boolean(item.id)
    && typeof item.name === 'string' && Boolean(item.name.trim())
    && typeof item.description === 'string'
    && typeof item.createdAt === 'number'
    && typeof item.updatedAt === 'number'
}

export function loadProjects(): WorkspaceProject[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(stored)) return []
    return stored.filter(isProject).sort((left, right) => right.updatedAt - left.updatedAt)
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
    createdAt: now,
    updatedAt: now,
  }
}
