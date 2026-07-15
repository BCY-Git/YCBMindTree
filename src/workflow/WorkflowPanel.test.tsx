import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createWorkflowSession } from '../ai/workflow/workflow-service'
import { WorkflowPanel } from './WorkflowPanel'

describe('WorkflowPanel assets', () => {
  it('offers a decision record in decision mode and requests it through the asset callback', () => {
    const onGenerateAsset = vi.fn()
    const session = createWorkflowSession('document-1', 'node-1', '选择地图方案', 'decide')
    session.checkpoints.push({ id: 'checkpoint-1', confirmed: ['采用 Three.js'], rejected: [], constraints: [], openQuestions: [], nextActions: [], sourceNodeIds: ['node-1'], createdAt: 1_000 })
    render(<WorkflowPanel
      session={session}
      suggestedGoal=""
      busy={false}
      onStart={vi.fn()}
      onChange={vi.fn()}
      onCheckpoint={vi.fn()}
      onDeposit={vi.fn()}
      onGenerateAsset={onGenerateAsset}
      onComplete={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '生成决策记录' }))
    expect(onGenerateAsset).toHaveBeenCalledWith('decision-record')
    expect(screen.queryByRole('button', { name: '生成知识卡' })).toBeNull()
  })

  it('keeps long-term asset generation disabled until the collaboration has a checkpoint', () => {
    render(<WorkflowPanel
      session={createWorkflowSession('document-1', 'node-1', '选择地图方案', 'decide')}
      suggestedGoal=""
      busy={false}
      onStart={vi.fn()}
      onChange={vi.fn()}
      onCheckpoint={vi.fn()}
      onDeposit={vi.fn()}
      onGenerateAsset={vi.fn()}
      onComplete={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '生成决策记录' }).hasAttribute('disabled')).toBe(true)
  })
})
