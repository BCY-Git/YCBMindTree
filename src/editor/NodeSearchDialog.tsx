import { useEffect, useMemo, useRef, useState } from 'react'
import type { MindMapDocument } from '../domain/document.types'
import { searchNodes } from './node-search'

type NodeSearchDialogProps = {
  document: MindMapDocument
  onClose: () => void
  onSelect: (nodeId: string) => void
  onCreate: (topic: string) => void
}

const matchLabel = { topic: '主题', note: '备注', link: '链接' }

export function NodeSearchDialog({ document, onClose, onSelect, onCreate }: NodeSearchDialogProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => searchNodes(document, query), [document, query])

  useEffect(() => { setActiveIndex(0) }, [query])
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
    if (result) onSelect(result.nodeId)
  }

  return (
    <div className="node-search-layer" role="dialog" aria-modal="true" aria-label="搜索导图" onMouseDown={onClose}>
      <section className="node-search" onMouseDown={(event) => event.stopPropagation()}>
        <div className="node-search__input">
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索主题、备注或链接…"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((current) => Math.min(current + 1, Math.max(0, results.length - 1))) }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)) }
              if (event.key === 'Enter') { event.preventDefault(); if (results.length) chooseActive(); else if (query.trim()) onCreate(query.trim()) }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="node-search__results">
          {!query.trim() ? <p className="node-search__empty">输入关键词，搜索整张导图。</p>
            : results.length ? results.map((result, index) => <button key={result.nodeId} className={index === activeIndex ? 'is-active' : ''} onMouseEnter={() => setActiveIndex(index)} onClick={() => onSelect(result.nodeId)}>
              <span><strong>{result.topic}</strong><small>{result.path}</small></span><i>{result.matchedIn.map((item) => matchLabel[item]).join(' · ')}</i>
            </button>)
              : <div className="node-search__empty"><p>没有匹配节点。</p><button onClick={() => onCreate(query.trim())}>将“{query.trim()}”创建为子节点</button></div>}
        </div>
        <footer><span><kbd>↑↓</kbd> 选择</span><span><kbd>↵</kbd> 定位</span><span><kbd>⌘ F</kbd> 搜索</span></footer>
      </section>
    </div>
  )
}
