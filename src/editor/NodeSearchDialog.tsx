import { useEffect, useMemo, useRef, useState } from 'react'
import type { DepositProvenance } from '../ai/deposit/deposit-types'
import type { MindMapDocument, MindNodePriority, MindNodeTaskStatus, NodeMark } from '../domain/document.types'
import type { Tag } from '../domain/tag-library'
import { nodeMarkMeta, nodeMarkOrder } from '../domain/node-semantics'
import { searchWorkspaceNodes, type WorkspaceSearchProvenanceRole } from '../search/workspace-search'

type NodeSearchDialogProps = {
  currentDocumentId: string
  documents: MindMapDocument[]
  tags: Tag[]
  provenance: DepositProvenance[]
  onClose: () => void
  onSelect: (documentId: string, nodeId: string) => void
  onCreate: (topic: string) => void
}

const matchLabel = { topic: '主题', note: '备注', link: '链接', tag: '标签' }
const statusOptions: Array<[MindNodeTaskStatus, string]> = [['todo', '待办'], ['doing', '进行中'], ['done', '已完成']]
const roleOptions: Array<[WorkspaceSearchProvenanceRole, string]> = [['source', '沉淀来源'], ['target', '沉淀结果']]

function toggleValue<T>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

export function NodeSearchDialog({ currentDocumentId, documents, tags, provenance, onClose, onSelect, onCreate }: NodeSearchDialogProps) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'current' | 'workspace'>('current')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [marks, setMarks] = useState<NodeMark[]>([])
  const [statuses, setStatuses] = useState<MindNodeTaskStatus[]>([])
  const [priorities, setPriorities] = useState<MindNodePriority[]>([])
  const [provenanceRoles, setProvenanceRoles] = useState<WorkspaceSearchProvenanceRole[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const currentDocument = documents.find((document) => document.id === currentDocumentId)
  const activeFilterCount = tagIds.length + marks.length + statuses.length + priorities.length + provenanceRoles.length
  const results = useMemo(() => searchWorkspaceNodes({
    documents,
    tags,
    provenance,
    text: query,
    includeDrafts: scope === 'current' && Boolean(currentDocument?.isDraft),
    filters: {
      documentIds: scope === 'current' ? [currentDocumentId] : [],
      tagIds,
      marks,
      statuses,
      priorities,
      provenanceRoles,
    },
  }), [currentDocument?.isDraft, currentDocumentId, documents, marks, priorities, provenance, provenanceRoles, query, scope, statuses, tagIds, tags])

  useEffect(() => { setActiveIndex(0) }, [marks, priorities, provenanceRoles, query, scope, statuses, tagIds])
  useEffect(() => {
    inputRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const chooseActive = () => {
    const result = results[activeIndex]
    if (result) onSelect(result.documentId, result.nodeId)
  }

  return (
    <div className="node-search-layer" role="dialog" aria-modal="true" aria-label="搜索工作区" onMouseDown={onClose}>
      <section className="node-search" onMouseDown={(event) => event.stopPropagation()}>
        <div className="node-search__input">
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索主题、备注、链接或标签…"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((current) => Math.min(current + 1, Math.max(0, results.length - 1))) }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)) }
              if (event.key === 'Enter') { event.preventDefault(); if (results.length) chooseActive(); else if (scope === 'current' && query.trim()) onCreate(query.trim()) }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="node-search__scope" aria-label="搜索范围">
          <button className={scope === 'current' ? 'is-active' : ''} onClick={() => setScope('current')}>当前导图</button>
          <button className={scope === 'workspace' ? 'is-active' : ''} onClick={() => setScope('workspace')}>全部导图</button>
          <button className={`node-search__filter-toggle ${activeFilterCount ? 'is-active' : ''}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>筛选{activeFilterCount ? ` ${activeFilterCount}` : ''}</button>
        </div>
        {filtersOpen && <div className="node-search__filters">
          {tags.length > 0 && <section><label>标签</label><div>{tags.map((tag) => <button key={tag.id} className={tagIds.includes(tag.id) ? 'is-active' : ''} onClick={() => setTagIds(toggleValue(tagIds, tag.id))}><i style={{ background: tag.color }} />{tag.name}</button>)}</div></section>}
          <section><label>任务</label><div>{statusOptions.map(([status, label]) => <button key={status} className={statuses.includes(status) ? 'is-active' : ''} onClick={() => setStatuses(toggleValue(statuses, status))}>{label}</button>)}</div></section>
          <section><label>标记</label><div>{nodeMarkOrder.map((mark) => <button key={mark} className={marks.includes(mark) ? 'is-active' : ''} onClick={() => setMarks(toggleValue(marks, mark))}>{nodeMarkMeta[mark].icon} {nodeMarkMeta[mark].label}</button>)}</div></section>
          <section><label>优先级</label><div>{([1, 2, 3] as MindNodePriority[]).map((priority) => <button key={priority} className={priorities.includes(priority) ? 'is-active' : ''} onClick={() => setPriorities(toggleValue(priorities, priority))}>P{priority}</button>)}</div></section>
          <section><label>来源</label><div>{roleOptions.map(([role, label]) => <button key={role} className={provenanceRoles.includes(role) ? 'is-active' : ''} onClick={() => setProvenanceRoles(toggleValue(provenanceRoles, role))}>{label}</button>)}</div></section>
          {activeFilterCount > 0 && <button className="node-search__clear-filters" onClick={() => { setTagIds([]); setMarks([]); setStatuses([]); setPriorities([]); setProvenanceRoles([]) }}>清除筛选</button>}
        </div>}
        <div className="node-search__results">
          {!query.trim() && !activeFilterCount ? <p className="node-search__empty">输入关键词或使用筛选，搜索{scope === 'current' ? '当前导图' : '全部正式导图'}。</p>
            : results.length ? results.map((result, index) => <button key={`${result.documentId}-${result.nodeId}`} className={index === activeIndex ? 'is-active' : ''} onMouseEnter={() => setActiveIndex(index)} onClick={() => onSelect(result.documentId, result.nodeId)}>
              <span><strong>{result.topic}</strong><small>{scope === 'workspace' ? `${result.documentTitle} · ${result.path}` : result.path}</small></span><i>{result.matchedIn.length ? result.matchedIn.map((item) => matchLabel[item]).join(' · ') : result.provenanceRoles.map((role) => role === 'source' ? '来源' : '结果').join(' · ')}</i>
            </button>)
              : <div className="node-search__empty"><p>没有匹配节点。</p>{scope === 'current' && <button onClick={() => onCreate(query.trim())}>将“{query.trim()}”创建为子节点</button>}</div>}
        </div>
        <footer><span><kbd>↑↓</kbd> 选择</span><span><kbd>↵</kbd> 定位</span><span><kbd>⌘ F</kbd> 搜索</span></footer>
      </section>
    </div>
  )
}
