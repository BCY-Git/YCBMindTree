import { useEffect, useState } from 'react'
import type { DocumentVersion } from './version-history'

type VersionHistoryDialogProps = {
  open: boolean
  documentTitle: string
  versions: DocumentVersion[]
  busy: boolean
  onClose: () => void
  onRefresh: () => void
  onCreateSnapshot: () => void
  onRestore: (version: DocumentVersion) => void
  onDuplicate: (version: DocumentVersion) => void
}

const kindLabel: Record<DocumentVersion['kind'], string> = {
  auto: '自动保存',
  manual: '手动快照',
  'restore-point': '恢复前备份',
  'sync-backup': '同步前备份',
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

export function VersionHistoryDialog({ open, documentTitle, versions, busy, onClose, onRefresh, onCreateSnapshot, onRestore, onDuplicate }: VersionHistoryDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    if (open) onRefresh()
  }, [onRefresh, open])
  useEffect(() => {
    if (!versions.some((version) => version.id === selectedId)) setSelectedId(versions[0]?.id ?? null)
  }, [selectedId, versions])

  if (!open) return null
  const selected = versions.find((version) => version.id === selectedId) ?? null
  const nodeCount = selected ? Object.keys(selected.snapshot.nodes).length : 0

  return <div className="version-history-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="version-history" role="dialog" aria-modal="true" aria-labelledby="version-history-title">
      <header>
        <div><p className="eyebrow">本地版本历史</p><h2 id="version-history-title">{documentTitle}</h2></div>
        <button className="version-history__close" onClick={onClose} aria-label="关闭版本历史">×</button>
      </header>
      <p className="version-history__intro">编辑停止后会自动创建快照；每张导图保留最近 30 个自动版本。恢复前会先为当前内容建立备份。</p>
      <div className="version-history__actions"><button onClick={onCreateSnapshot} disabled={busy}>创建当前快照</button><button className="version-history__refresh" onClick={onRefresh} disabled={busy}>刷新</button></div>
      <div className="version-history__body">
        <div className="version-history__list" aria-label="历史版本列表">
          {!versions.length && <p>尚无历史版本。编辑导图后停顿片刻，系统会自动建立快照。</p>}
          {versions.map((version) => <button key={version.id} className={version.id === selectedId ? 'is-selected' : ''} onClick={() => setSelectedId(version.id)}>
            <span><strong>{version.label ?? kindLabel[version.kind]}</strong><small>{kindLabel[version.kind]} · {formatTime(version.createdAt)}</small></span>
            <i>{Object.keys(version.snapshot.nodes).length}</i>
          </button>)}
        </div>
        <div className="version-history__preview">
          {selected ? <>
            <p className="eyebrow">版本预览</p>
            <h3>{selected.snapshot.title}</h3>
            <dl><div><dt>保存时间</dt><dd>{formatTime(selected.createdAt)}</dd></div><div><dt>节点数量</dt><dd>{nodeCount} 个</dd></div><div><dt>根主题</dt><dd>{selected.snapshot.nodes[selected.snapshot.rootId]?.topic ?? '—'}</dd></div></dl>
            <button className="version-history__restore" disabled={busy} onClick={() => onRestore(selected)}>恢复此版本</button>
            <button className="version-history__duplicate" disabled={busy} onClick={() => onDuplicate(selected)}>另存为副本</button>
          </> : <p>在左侧选择一个版本以查看详情。</p>}
        </div>
      </div>
    </section>
  </div>
}
