import type { WorkflowMode, WorkflowPhase, WorkflowSession } from '../ai/workflow/workflow-types'
import { workflowModes, workflowPhases } from '../ai/workflow/workflow-types'

const modeLabels: Record<WorkflowMode, string> = { explore: '探索', decide: '决策', deliver: '交付' }
const phaseLabels: Record<WorkflowPhase, string> = { context: '背景确认', understanding: '理解问题', modeling: '建立方案', validation: '验证', criteria: '验收标准', execution: '执行', review: '复核', deposit: '沉淀', completed: '已完成' }

function lines(value: string) {
  return value.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 20)
}

export function WorkflowPanel({ session, suggestedGoal, busy, onStart, onChange, onCheckpoint, onDeposit, onComplete }: {
  session: WorkflowSession | null
  suggestedGoal: string
  busy: boolean
  onStart: (mode: WorkflowMode) => void
  onChange: (patch: Partial<WorkflowSession>) => void
  onCheckpoint: () => void
  onDeposit: () => void
  onComplete: () => void
}) {
  if (!session) return <section className="workflow-panel workflow-panel--empty"><div><strong>围绕当前节点开始协作</strong><small>记录模式、目标、约束和阶段检查点</small></div><div className="workflow-panel__modes">{workflowModes.map((mode) => <button type="button" key={mode} onClick={() => onStart(mode)}>{modeLabels[mode]}</button>)}</div>{suggestedGoal && <p>将以当前输入作为初始目标。</p>}</section>
  const latest = session.checkpoints.at(-1)
  return <section className="workflow-panel">
    <div className="workflow-panel__heading"><strong>智能协作</strong><span>{modeLabels[session.mode]} · {phaseLabels[session.phase]}</span></div>
    <div className="workflow-panel__state"><label>模式<select value={session.mode} onChange={(event) => onChange({ mode: event.target.value as WorkflowMode })}>{workflowModes.map((mode) => <option key={mode} value={mode}>{modeLabels[mode]}</option>)}</select></label><label>阶段<select value={session.phase} onChange={(event) => onChange({ phase: event.target.value as WorkflowPhase })}>{workflowPhases.filter((phase) => phase !== 'completed').map((phase) => <option key={phase} value={phase}>{phaseLabels[phase]}</option>)}</select></label></div>
    <label>当前目标<input value={session.goal} onChange={(event) => onChange({ goal: event.target.value })} placeholder="这次协作希望解决什么？" /></label>
    <details><summary>目标受众、交付物与约束</summary><div className="workflow-panel__details"><label>目标受众<input value={session.audience} onChange={(event) => onChange({ audience: event.target.value })} /></label><label>最终交付物<input value={session.deliverable} onChange={(event) => onChange({ deliverable: event.target.value })} /></label><label>当前约束<textarea rows={3} value={session.constraints.join('\n')} onChange={(event) => onChange({ constraints: lines(event.target.value) })} placeholder="每行一项" /></label><label>验收标准<textarea rows={3} value={session.acceptanceCriteria.join('\n')} onChange={(event) => onChange({ acceptanceCriteria: lines(event.target.value) })} placeholder="每行一项" /></label></div></details>
    {latest && <details className="workflow-checkpoint"><summary>最近检查点 · {new Date(latest.createdAt).toLocaleString('zh-CN')}</summary><dl><dt>已确认</dt><dd>{latest.confirmed.join('；') || '无'}</dd><dt>已排除</dt><dd>{latest.rejected.join('；') || '无'}</dd><dt>待确认</dt><dd>{latest.openQuestions.join('；') || '无'}</dd><dt>下一步</dt><dd>{latest.nextActions.join('；') || '无'}</dd></dl></details>}
    <div className="workflow-panel__actions"><button type="button" disabled={busy} onClick={onCheckpoint}>{busy ? '生成中…' : '生成检查点'}</button><button type="button" disabled={busy || !latest} onClick={onDeposit}>沉淀检查点</button><button type="button" disabled={busy} onClick={onComplete}>完成协作</button></div>
  </section>
}
