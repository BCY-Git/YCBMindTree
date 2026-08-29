import { beforeEach, describe, expect, it } from 'vitest'
import { createProject, loadProjects, saveProjects } from '@/projects/project-library'

describe('project library', () => {
  beforeEach(() => localStorage.clear())

  it('persists a named project and its planning description', () => {
    const project = createProject('算法刷题计划', '按专题整理题型与错题复盘')
    saveProjects([project])

    expect(loadProjects()).toEqual([project])
  })

  it('ignores malformed local data', () => {
    localStorage.setItem('mindtree.projects.v1', JSON.stringify([{ id: 'broken', name: '' }]))
    expect(loadProjects()).toEqual([])
  })

  it('migrates legacy archived projects into the lifecycle model', () => {
    localStorage.setItem('mindtree.projects.v1', JSON.stringify([{ id: 'legacy', name: '旧项目', description: '历史资料', archived: true, createdAt: 1, updatedAt: 2 }]))

    expect(loadProjects()).toEqual([{ id: 'legacy', name: '旧项目', description: '历史资料', objective: '历史资料', status: 'archived', pinned: false, createdAt: 1, updatedAt: 2 }])
  })
})
