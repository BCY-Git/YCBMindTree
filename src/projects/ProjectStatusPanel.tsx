import type { MindMapDocument } from '../domain/document.types'
import type { ProjectStatus, ProjectStatusItem } from './project-status'

function sourceLabel(documents: MindMapDocument[], item: ProjectStatusItem) {
  if (!item.source) return null
  const document = documents.find((candidate) => candidate.id === item.source?.documentId)
  const node = document && item.source.nodeIds.map((nodeId) => document.nodes[nodeId]).find(Boolean)
  if (!document || !node) return null
  return { documentId: document.id, nodeId: node.id, label: `${document.title} › ${node.topic || '未命名主题'}` }
}

function StatusGroup({ label, items, documents, onRevealSource }: { label: string; items: ProjectStatusItem[]; documents: MindMapDocument[]; onRevealSource: (documentId: string, nodeId: string) => void }) {
  if (!items.length) return null
  return <section className="project-status__group" aria-label={label}>
    <h4>{label}<span>{items.length}</span></h4>
    <ul>
      {items.slice(0, 5).map((item) => {
        const source = sourceLabel(documents, item)
        return <li key={item.id}>
          <div><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</div>
          {source && <button type="button" onClick={() => onRevealSource(source.documentId, source.nodeId)} title={source.label}>查看来源</button>}
        </li>
      })}
    </ul>
  </section>
}

/** 项目状态是已有树、任务、确认沉淀的只读投影，不额外复制项目数据。 */
export function ProjectStatusPanel({ status, documents, onRevealSource, onRefresh, onStartDeposit, refreshing }: {
  status: ProjectStatus
  documents: MindMapDocument[]
  onRevealSource: (documentId: string, nodeId: string) => void
  onRefresh: () => void
  onStartDeposit: () => void
  refreshing: boolean
}) {
  const hasContent = status.active.length || status.blockers.length || status.recentResults.length || status.decisions.length || status.nextActions.length
  return <section className="project-status" aria-label="项目状态">
    <header><div><p className="field-label">项目状态</p><h3>{status.goal}</h3></div><div className="project-status__actions"><button type="button" className="project-status__deposit" onClick={onStartDeposit}>整理本分支</button><button type="button" onClick={onRefresh} disabled={refreshing} aria-label="刷新项目状态">{refreshing ? '刷新中…' : '刷新'}</button></div></header>
    <div className="project-status__progress"><strong>完成 {status.progress.done} / {status.progress.total} 项任务</strong><span aria-hidden="true"><i style={{ width: `${status.progress.total ? Math.round(status.progress.done / status.progress.total * 100) : 0}%` }} /></span></div>
    {hasContent ? <div className="project-status__groups">
      <StatusGroup label="正在推进" items={status.active} documents={documents} onRevealSource={onRevealSource} />
      <StatusGroup label="阻塞与风险" items={status.blockers} documents={documents} onRevealSource={onRevealSource} />
      <StatusGroup label="最近成果" items={status.recentResults} documents={documents} onRevealSource={onRevealSource} />
      <StatusGroup label="已确认决策" items={status.decisions} documents={documents} onRevealSource={onRevealSource} />
      <StatusGroup label="下一步" items={status.nextActions} documents={documents} onRevealSource={onRevealSource} />
    </div> : <p className="project-status__empty">此分支尚未形成任务、风险或已确认沉淀。继续自然记录，之后可在 AI 助手中生成沉淀建议。</p>}
    {status.provenanceCount > 0 && <small className="project-status__trace">本状态关联 {status.provenanceCount} 条已确认沉淀记录。</small>}
  </section>
}
