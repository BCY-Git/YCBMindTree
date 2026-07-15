export const workflowModes = ['explore', 'decide', 'deliver'] as const
export type WorkflowMode = typeof workflowModes[number]

export const workflowPhases = ['context', 'understanding', 'modeling', 'validation', 'criteria', 'execution', 'review', 'deposit', 'completed'] as const
export type WorkflowPhase = typeof workflowPhases[number]

export type WorkflowCheckpoint = {
  id: string
  confirmed: string[]
  rejected: string[]
  constraints: string[]
  openQuestions: string[]
  nextActions: string[]
  sourceNodeIds: string[]
  createdAt: number
}

export type WorkflowSession = {
  id: string
  documentId: string
  focusNodeId: string
  mode: WorkflowMode
  phase: WorkflowPhase
  status: 'active' | 'completed'
  goal: string
  audience: string
  deliverable: string
  constraints: string[]
  acceptanceCriteria: string[]
  confirmedFacts: string[]
  rejectedOptions: string[]
  openQuestions: string[]
  nextActions: string[]
  checkpoints: WorkflowCheckpoint[]
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export type WorkflowCheckpointProposal = Omit<WorkflowCheckpoint, 'id' | 'sourceNodeIds' | 'createdAt'>
