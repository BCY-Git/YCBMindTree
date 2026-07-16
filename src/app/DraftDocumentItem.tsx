type DraftDocumentItemProps = {
  title: string
  active: boolean
  onOpen: () => void
  onDelete: () => void
}

/** 随手记草稿列表项：打开与删除是两个独立操作，避免误触。 */
export function DraftDocumentItem({ title, active, onOpen, onDelete }: DraftDocumentItemProps) {
  return <article className={`sidebar-draft-item ${active ? 'is-active' : ''}`}>
    <button type="button" className="sidebar-document" onClick={onOpen}>
      <span className="sidebar-document__icon">✦</span>
      <span className="sidebar-document__copy"><strong>{title}</strong><small>草稿 · 已自动保存到本机</small></span>
    </button>
    <button type="button" className="sidebar-document__delete" onClick={onDelete} aria-label={`删除随手记“${title}”`} title="删除随手记">×</button>
  </article>
}
