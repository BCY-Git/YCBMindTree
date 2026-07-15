import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { DepositProvenance } from '../ai/deposit/deposit-types'
import type { MindMapDocument } from '../domain/document.types'
import type { Tag } from '../domain/tag-library'
import { NodeSearchDialog } from '../editor/NodeSearchDialog'
import { listAllDepositProvenance } from '../persistence/database'
import { useEditorStore } from '../store/editor.store'
import { projectFocusedDocument } from '../focus/focus-projection'
import { buildOutlineRows, outlineSiblingMove } from './outline-model'

const taskLabel = { none: '普通主题', todo: '待办', doing: '进行中', done: '已完成' }
const nextTaskStatus = { none: 'todo', todo: 'doing', doing: 'done', done: 'none' } as const

export function OutlineView({ tags, workspaceDocuments = [], onRevealWorkspaceNode, focusRootId = null }: {
  tags: Tag[]
  workspaceDocuments?: MindMapDocument[]
  onRevealWorkspaceNode?: (documentId: string, nodeId: string) => void
  focusRootId?: string | null
}) {
  const document = useEditorStore((state) => state.document)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const editingNodeId = useEditorStore((state) => state.editingNodeId)
  const dispatch = useEditorStore((state) => state.dispatch)
  const selectNode = useEditorStore((state) => state.selectNode)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchProvenance, setSearchProvenance] = useState<DepositProvenance[]>([])
  const rowsRef = useRef<HTMLDivElement>(null)
  const viewDocument = useMemo(() => focusRootId ? projectFocusedDocument(document, focusRootId) : document, [document, focusRootId])
  const rows = useMemo(() => buildOutlineRows(viewDocument), [viewDocument])
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags])

  useEffect(() => {
    if (!editingNodeId) return
    const input = [...(rowsRef.current?.querySelectorAll<HTMLInputElement>('[data-outline-node]') ?? [])].find((candidate) => candidate.dataset.outlineNode === editingNodeId)
    input?.focus()
    input?.select()
  }, [editingNodeId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!searchOpen) return
    void listAllDepositProvenance().then(setSearchProvenance).catch(() => setSearchProvenance([]))
  }, [searchOpen])

  const revealSearchResult = (documentId: string, nodeId: string) => {
    if (documentId !== document.id) onRevealWorkspaceNode?.(documentId, nodeId)
    else if (dispatch({ type: 'REVEAL_NODE', nodeId })) selectNode(nodeId)
    setSearchOpen(false)
  }

  return <section className="outline-view" aria-label="大纲视图">
    <header className="outline-view__header">
      <div><p className="eyebrow">{focusRootId ? '聚焦分支' : '结构化大纲'}</p><h2>{focusRootId ? document.nodes[focusRootId]?.topic ?? document.title : document.title}</h2><span>与导图共享同一份节点和折叠状态</span></div>
      <div className="outline-view__header-actions"><output>{Object.keys(viewDocument.nodes).length} / {Object.keys(document.nodes).length} 个主题</output><button type="button" onClick={() => setSearchOpen(true)}>⌕ 搜索</button></div>
    </header>
    <div className="outline-view__columns" aria-hidden="true"><span>主题</span><span>状态与内容</span></div>
    <div className="outline-view__rows" ref={rowsRef}>
      {rows.map(({ node, depth, hasChildren, hiddenChildCount }) => {
        const nodeTags = node.tagIds.flatMap((tagId) => tagById.get(tagId) ?? [])
        return <div
          key={node.id}
          className={`outline-row ${selectedNodeId === node.id ? 'is-selected' : ''} ${node.id === document.rootId ? 'is-root' : ''} ${node.isFreeTopic ? 'is-free-topic' : ''}`}
          style={{ '--outline-depth': depth } as CSSProperties}
          onMouseDown={() => selectNode(node.id)}
        >
          <span className="outline-row__guide" aria-hidden="true" />
          {hasChildren ? <button
            type="button"
            className="outline-row__fold"
            onClick={(event) => { event.stopPropagation(); dispatch({ type: 'TOGGLE_COLLAPSE', nodeId: node.id }) }}
            aria-label={`${node.collapsed ? '展开' : '折叠'} ${node.topic || '未命名主题'}`}
            title={node.collapsed ? `展开 ${hiddenChildCount} 个直接子主题` : '折叠分支'}
          >{node.collapsed ? '›' : '⌄'}</button> : <span className="outline-row__fold-placeholder" />}
          <span className="outline-row__bullet" aria-hidden="true" />
          <input
            data-outline-node={node.id}
            value={node.topic}
            aria-label={`${node.topic || '未命名主题'}的标题`}
            onFocus={() => selectNode(node.id)}
            onChange={(event) => dispatch({ type: 'UPDATE_NODE_TOPIC', nodeId: node.id, topic: event.target.value })}
            onKeyDown={(event) => {
              if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                event.preventDefault()
                const command = outlineSiblingMove(document, node.id, event.key === 'ArrowUp' ? 'up' : 'down')
                if (command) dispatch(command)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                if (!node.isFreeTopic) dispatch(node.id === viewDocument.rootId ? { type: 'ADD_CHILD', parentId: node.id } : { type: 'ADD_SIBLING', nodeId: node.id })
              } else if (event.key === 'Tab') {
                event.preventDefault()
                dispatch(event.shiftKey ? { type: 'OUTDENT_NODE', nodeId: node.id } : { type: 'INDENT_NODE', nodeId: node.id })
              }
            }}
          />
          <div className="outline-row__meta">
            <button
              type="button"
              className={`outline-row__task is-${node.taskStatus}`}
              onClick={(event) => { event.stopPropagation(); dispatch({ type: 'SET_NODE_TASK_STATUS', nodeId: node.id, taskStatus: nextTaskStatus[node.taskStatus] }) }}
              title={`任务状态：${taskLabel[node.taskStatus]}，点击切换`}
              aria-label={`${node.topic || '未命名主题'}：${taskLabel[node.taskStatus]}`}
            >{node.taskStatus === 'done' ? '✓' : node.taskStatus === 'doing' ? '◐' : node.taskStatus === 'todo' ? '○' : '·'}</button>
            {node.note && <span title="包含备注">备注</span>}
            {node.links.length > 0 && <span title={`${node.links.length} 个链接`}>链接 {node.links.length}</span>}
            {node.attachments.length > 0 && <span title={`${node.attachments.length} 个附件`}>附件 {node.attachments.length}</span>}
            {nodeTags.map((tag) => <i key={tag.id} style={{ '--tag-color': tag.color } as CSSProperties}>{tag.name}</i>)}
            {node.isFreeTopic && <em>自由主题</em>}
          </div>
        </div>
      })}
    </div>
    <footer className="outline-view__footer"><span><kbd>Enter</kbd> 新建同级</span><span><kbd>Tab</kbd> 缩进</span><span><kbd>⇧ Tab</kbd> 减少缩进</span><span><kbd>⌥ ↑↓</kbd> 调整顺序</span><span>切回导图后位置与结构立即同步</span></footer>
    {searchOpen && <NodeSearchDialog currentDocumentId={document.id} documents={[document, ...workspaceDocuments.filter((item) => item.id !== document.id)]} tags={tags} provenance={searchProvenance} onClose={() => setSearchOpen(false)} onSelect={revealSearchResult} onCreate={(topic) => { const parentId = selectedNodeId ?? document.rootId; if (dispatch({ type: 'ADD_CHILD', parentId, topic })) setSearchOpen(false) }} />}
  </section>
}
