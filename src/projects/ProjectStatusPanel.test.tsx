import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectStatusPanel } from './ProjectStatusPanel'
import type { ProjectStatus } from './project-status'
import { createInitialDocument } from '../domain/document.factory'

const status: ProjectStatus = {
  rootNodeId: 'project', goal: '无人项目', progress: { done: 2, total: 5 }, provenanceCount: 1,
  active: [{ id: 'task', title: '修复得分 bug', detail: '', updatedAt: 1, nodeId: 'task', taskStatus: 'doing', priority: 1, source: null }],
  blockers: [{ id: 'problem', title: '地图瓦片路径待确认', detail: '出差前处理', updatedAt: 2, nodeId: 'project', taskStatus: null, priority: 0, source: { documentId: 'daily', nodeIds: ['daily-node'], snapshot: '7.14 › 地图瓦片路径' } }],
  recentResults: [{ id: 'result', title: 'AFSIM PPT 已交付', detail: '', updatedAt: 3, nodeId: 'project', taskStatus: null, priority: 0, source: { documentId: 'daily', nodeIds: ['daily-node'], snapshot: '7.14 › PPT' } }],
  decisions: [{ id: 'decision', title: '第一阶段采用 Three.js', detail: '', updatedAt: 4, nodeId: 'project', taskStatus: null, priority: 0, source: null }],
  nextActions: [{ id: 'next', title: '修复得分 bug', detail: '', updatedAt: 1, nodeId: 'task', taskStatus: 'doing', priority: 1, source: null }],
}

describe('ProjectStatusPanel', () => {
  it('shows project progress and lets the user return to the original record', () => {
    const daily = createInitialDocument()
    daily.id = 'daily'
    daily.nodes[daily.rootId].id = 'daily-node'
    daily.nodes = { 'daily-node': daily.nodes[daily.rootId] }
    const onReveal = vi.fn()

    render(<ProjectStatusPanel status={status} documents={[daily]} onRevealSource={onReveal} onRefresh={vi.fn()} onStartDeposit={vi.fn()} refreshing={false} />)

    expect(screen.getByRole('heading', { name: '无人项目' })).toBeTruthy()
    expect(screen.getByText('完成 2 / 5 项任务')).toBeTruthy()
    expect(screen.getByText('地图瓦片路径待确认')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '查看来源' })[0])
    expect(onReveal).toHaveBeenCalledWith('daily', 'daily-node')
  })

  it('offers a refresh action without making state changes itself', () => {
    const onRefresh = vi.fn()
    render(<ProjectStatusPanel status={status} documents={[]} onRevealSource={vi.fn()} onRefresh={onRefresh} onStartDeposit={vi.fn()} refreshing={false} />)
    fireEvent.click(screen.getByRole('button', { name: '刷新项目状态' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('offers an explicit route from project state to deposit analysis', () => {
    const onStartDeposit = vi.fn()
    render(<ProjectStatusPanel status={status} documents={[]} onRevealSource={vi.fn()} onRefresh={vi.fn()} onStartDeposit={onStartDeposit} refreshing={false} />)
    fireEvent.click(screen.getByRole('button', { name: '整理本分支' }))
    expect(onStartDeposit).toHaveBeenCalledOnce()
  })
})
