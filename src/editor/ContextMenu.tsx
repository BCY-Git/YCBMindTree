/**
 * ContextMenu — 右键弹出菜单。
 *
 * 支持两种模式：
 * - 画布模式（node === null）：新建一级节点、编辑中心主题、自动排列
 * - 节点模式：增删改、层级调整、复制粘贴、重置位置、删除分支
 *
 * 菜单在视口边缘自动收缩，防止溢出；点击菜单外部或按 Escape 关闭。
 */
import { useEffect, useRef } from 'react'
import type { MindMapRelation, MindNode } from '../domain/document.types'

export type ContextMenuPosition = { x: number; y: number }

type ContextMenuProps = {
  position: ContextMenuPosition
  node: MindNode | null
  relation: MindMapRelation | null
  isRoot: boolean
  onAddChild: () => void
  onAddSibling: () => void
  onEdit: () => void
  onCreateRelation: () => void
  onToggleCollapse: () => void
  onCollapseDescendants: () => void
  onExpandDescendants: () => void
  onFocusRoot: () => void
  onIndent: () => void
  onOutdent: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onResetPosition: () => void
  onAutoArrange: () => void
  onRestoreFreeform: () => void
  onDelete: () => void
  onDeleteRelation: () => void
  hasClipboard: boolean
  hasFreeformHistory: boolean
  canOutdent: boolean
  canIndent: boolean
  onClose: () => void
}

function MenuItem({ children, shortcut, destructive, disabled, onClick }: {
  children: string
  shortcut?: string
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button className={`context-menu__item ${destructive ? 'is-destructive' : ''}`} disabled={disabled} onClick={onClick}>
      <span>{children}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  )
}

export function ContextMenu({ position, node, relation, isRoot, onAddChild, onAddSibling, onEdit, onCreateRelation, onToggleCollapse, onCollapseDescendants, onExpandDescendants, onFocusRoot, onIndent, onOutdent, onCopy, onCut, onPaste, onResetPosition, onAutoArrange, onRestoreFreeform, onDelete, onDeleteRelation, hasClipboard, hasFreeformHistory, canOutdent, canIndent, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const isCanvasMenu = node === null && relation === null

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as HTMLElement)) onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  const style = {
    left: Math.min(position.x, window.innerWidth - 238),
    top: Math.min(position.y, window.innerHeight - (relation ? 148 : isCanvasMenu ? 346 : 670)),
  }

  return (
    <div ref={menuRef} className="context-menu" style={style} role="menu" onContextMenu={(event) => event.preventDefault()}>
      <p className="context-menu__title">{relation ? '关系线' : isCanvasMenu ? '画布' : isRoot ? '中心主题' : '当前节点'}</p>
      {relation ? (
        <>
          <div className="context-menu__hint">“{relation.label}” · 可在右侧修改说明</div>
          <div className="context-menu__divider" />
          <MenuItem onClick={onDeleteRelation} shortcut="⌫" destructive>删除关系</MenuItem>
        </>
      ) : isCanvasMenu ? (
        <>
          <MenuItem onClick={onAddChild} shortcut="Tab">新建一级节点</MenuItem>
          <MenuItem onClick={onEdit} shortcut="F2">编辑中心主题</MenuItem>
          <div className="context-menu__divider" />
          <MenuItem onClick={onFocusRoot}>前往中心主题</MenuItem>
          <MenuItem onClick={onCollapseDescendants}>折叠所有次级分支</MenuItem>
          <MenuItem onClick={onExpandDescendants}>展开所有次级分支</MenuItem>
          <div className="context-menu__divider" />
          <MenuItem onClick={onAutoArrange}>自动排列</MenuItem>
          <MenuItem onClick={onRestoreFreeform} disabled={!hasFreeformHistory}>恢复自由排布</MenuItem>
          <div className="context-menu__hint">一张导图目前保持一个中心主题</div>
        </>
      ) : node ? (
        <>
          <MenuItem onClick={onAddChild} shortcut="Tab">新建子节点</MenuItem>
          <MenuItem onClick={onAddSibling} shortcut="Enter" disabled={isRoot}>新建同级节点</MenuItem>
          <div className="context-menu__divider" />
          <MenuItem onClick={onEdit} shortcut="F2">编辑主题</MenuItem>
          <MenuItem onClick={onCreateRelation}>创建关系…</MenuItem>
          <MenuItem onClick={onToggleCollapse} shortcut="Space" disabled={!node.childIds.length}>{node.collapsed ? '展开分支' : '折叠分支'}</MenuItem>
          <MenuItem onClick={onCollapseDescendants} disabled={!node.childIds.length}>折叠所有次级分支</MenuItem>
          <MenuItem onClick={onExpandDescendants} disabled={!node.childIds.length}>展开所有次级分支</MenuItem>
          <MenuItem onClick={onFocusRoot}>前往中心主题</MenuItem>
          <MenuItem onClick={onIndent} shortcut="⌥ →" disabled={!canIndent}>降低层级</MenuItem>
          <MenuItem onClick={onOutdent} shortcut="⇧ Tab" disabled={!canOutdent}>提升层级</MenuItem>
          <div className="context-menu__divider" />
          <MenuItem onClick={onCopy} shortcut="⌘ C">复制分支</MenuItem>
          <MenuItem onClick={onCut} shortcut="⌘ X" disabled={isRoot}>剪切分支</MenuItem>
          <MenuItem onClick={onPaste} shortcut="⌘ V" disabled={!hasClipboard}>粘贴为子节点</MenuItem>
          <MenuItem onClick={onResetPosition} shortcut="—">重置节点位置</MenuItem>
          <div className="context-menu__divider" />
          <MenuItem onClick={onAutoArrange}>自动排列</MenuItem>
          <MenuItem onClick={onRestoreFreeform} disabled={!hasFreeformHistory}>恢复自由排布</MenuItem>
          <div className="context-menu__divider" />
          <MenuItem onClick={onDelete} shortcut="⌫" destructive disabled={isRoot}>删除分支</MenuItem>
        </>
      ) : null}
    </div>
  )
}
