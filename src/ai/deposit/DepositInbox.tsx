import { useState } from 'react'
import type { MindMapDocument } from '../../domain/document.types'
import { depositActions, depositCandidateTypes, type DepositBatch, type DepositCandidate } from './deposit-types'

const typeLabels: Record<DepositCandidate['type'], string> = { fact: '事实', result: '成果', task: '任务', problem: '问题', decision: '决策', knowledge: '知识', idea: '想法' }
const actionLabels: Record<DepositCandidate['action'], string> = { keep: '仅保留原记录', create: '新增节点', update: '更新备注', complete: '完成任务', 'append-note': '追加备注' }

function nodePath(document: MindMapDocument, nodeId: string) {
  const path: string[] = []
  let current: MindMapDocument['nodes'][string] | undefined = document.nodes[nodeId]
  while (current) {
    path.unshift(current.topic)
    current = current.parentId ? document.nodes[current.parentId] : undefined
  }
  return path.join(' › ')
}

export function DepositInbox({ batch, document, workspaceDocuments, onChange, onChangeAll, onPreview, onDismiss }: {
  batch: DepositBatch
  document: MindMapDocument
  workspaceDocuments: MindMapDocument[]
  onChange: (candidateId: string, patch: Partial<DepositCandidate>) => void
  onChangeAll: (candidateIds: string[], status: 'pending' | 'accepted') => void
  onPreview: () => void
  onDismiss: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const candidates = batch.candidates.filter((candidate) => candidate.status !== 'ignored' && candidate.status !== 'applied')
  const acceptedCount = candidates.filter((candidate) => candidate.status === 'accepted').length
  return <section className="deposit-inbox" aria-label="待沉淀收件箱">
    <div className="deposit-inbox__heading"><strong>待沉淀内容</strong><span>{candidates.length} 条</span></div>
    {!!candidates.length && <div className="deposit-inbox__bulk"><button type="button" onClick={() => onChangeAll(candidates.filter((candidate) => !candidate.duplicateOfCandidateId && candidate.confidence >= 0.6).map((candidate) => candidate.id), 'accepted')}>选择建议项</button><button type="button" onClick={() => onChangeAll(candidates.map((candidate) => candidate.id), 'pending')}>全部取消</button></div>}
    {batch.summary && <p className="deposit-inbox__summary">{batch.summary}</p>}
    {!candidates.length && <p className="deposit-inbox__empty">本批建议已处理。</p>}
    <div className="deposit-inbox__list">{candidates.map((candidate) => {
      const targetDocument = workspaceDocuments.find((item) => item.id === candidate.suggestedDocumentId) ?? null
      const nodes = targetDocument ? Object.values(targetDocument.nodes) : []
      const targetId = candidate.action === 'create' ? candidate.suggestedParentId : candidate.suggestedTargetNodeId
      const open = expanded === candidate.id
      return <article className={`deposit-candidate ${candidate.duplicateOfCandidateId ? 'is-duplicate' : ''}`} key={candidate.id}>
        <label className="deposit-candidate__check"><input type="checkbox" checked={candidate.status === 'accepted'} onChange={(event) => onChange(candidate.id, { status: event.target.checked ? 'accepted' : 'pending' })} /><span>{typeLabels[candidate.type]}</span></label>
        <div className="deposit-candidate__main"><strong>{candidate.title}</strong><small>{candidate.duplicateOfCandidateId ? '可能已沉淀，默认不选中' : `置信度 ${Math.round(candidate.confidence * 100)}%`}</small></div>
        <button type="button" className="deposit-candidate__detail" onClick={() => setExpanded(open ? null : candidate.id)}>{open ? '收起' : '修改'}</button>
        <p>来源：{candidate.sourceNodeIds.map((id) => nodePath(document, id)).join('；')}</p>
        <p>去向：{targetDocument ? `${targetDocument.title}${targetId ? ` › ${nodePath(targetDocument, targetId)}` : ' › 待选择节点'}` : '待选择导图'}</p>
        {open && <div className="deposit-candidate__editor">
          <label>类型<select value={candidate.type} onChange={(event) => onChange(candidate.id, { type: event.target.value as DepositCandidate['type'] })}>{depositCandidateTypes.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}</select></label>
          <label>动作<select value={candidate.action} onChange={(event) => onChange(candidate.id, { action: event.target.value as DepositCandidate['action'] })}>{depositActions.map((action) => <option key={action} value={action}>{actionLabels[action]}</option>)}</select></label>
          <label>标题<input value={candidate.title} onChange={(event) => onChange(candidate.id, { title: event.target.value })} /></label>
          <label>说明<textarea rows={3} value={candidate.detail} onChange={(event) => onChange(candidate.id, { detail: event.target.value })} /></label>
          {candidate.action !== 'keep' && <><label>目标导图<select value={candidate.suggestedDocumentId ?? ''} onChange={(event) => {
            const target = workspaceDocuments.find((item) => item.id === event.target.value)
            onChange(candidate.id, { suggestedDocumentId: target?.id ?? null, suggestedParentId: candidate.action === 'create' ? target?.rootId ?? null : null, suggestedTargetNodeId: null })
          }}><option value="">请选择</option>{workspaceDocuments.filter((item) => !item.isDraft || item.id === document.id).map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><label>目标{candidate.action === 'create' ? '父节点' : '节点'}<select value={targetId ?? ''} disabled={!targetDocument} onChange={(event) => onChange(candidate.id, candidate.action === 'create' ? { suggestedParentId: event.target.value || null } : { suggestedTargetNodeId: event.target.value || null })}><option value="">请选择</option>{nodes.filter((node) => candidate.action !== 'create' || !node.isFreeTopic).map((node) => <option value={node.id} key={node.id}>{targetDocument ? nodePath(targetDocument, node.id) : node.topic}</option>)}</select></label></>}
          <small className="deposit-candidate__reason">AI 判断：{candidate.reason || '未提供'}</small>
        </div>}
        <button type="button" className="deposit-candidate__ignore" onClick={() => onChange(candidate.id, { status: 'ignored' })}>忽略</button>
      </article>
    })}</div>
    <div className="deposit-inbox__actions"><button type="button" disabled={!acceptedCount} onClick={onPreview}>预览并写入{acceptedCount ? `（${acceptedCount}）` : ''}</button><button type="button" onClick={onDismiss}>稍后处理</button></div>
  </section>
}
