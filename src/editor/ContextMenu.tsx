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
import type { MindMapRelation, MindNode, NodeMark } from '../domain/document.types'
import { nodeMarkMeta, nodeMarkOrder } from '../domain/node-semantics'

export type ContextMenuPosition = { x: number; y: number }

type ContextMenuProps = {
  position: ContextMenuPosition
  node: MindNode | null
  relation: MindMapRelation | null
  isRoot: boolean
  onAddChild: () => void
  onAddSibling: () => void
  onAddSiblingBefore: () => void
  onAddParent: () => void
  onDuplicate: () => void
  onAddFreeTopic: () => void
  onAttachToRoot: () => void
  onEdit: () => void
  onToggleMark: (mark: NodeMark) => void
  onCreateRelation: () => void
  onCreateBoundary: () => void
  onCreateSummary: () => void
  onToggleCollapse: () => void
  onCollapseDescendants: () => void
  onExpandDescendants: () => void
  onFocusRoot: () => void
  onFocusBranch: () => void
  onSelectBranch: () => void
  onSelectSiblings: () => void
  onSelectAll: () => void
  onIndent: () => void
  onOutdent: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onPasteImage: () => void
  onResetPosition: () => void
  onAutoArrange: () => void
  onRestoreFreeform: () => void
  onDelete: () => void
  onDeleteSingle: () => void
  onResetRelationCurve: () => void
  onDeleteRelation: () => void
  hasClipboard: boolean
  hasFreeformHistory: boolean
  canOutdent: boolean
  canIndent: boolean
  canCreateBoundary: boolean
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

export function ContextMenu({ position, node, relation, isRoot, onAddChild, onAddSibling, onAddSiblingBefore, onAddParent, onDuplicate, onAddFreeTopic, onAttachToRoot, onEdit, onToggleMark, onCreateRelation, onCreateBoundary, onCreateSummary, onToggleCollapse, onCollapseDescendants, onExpandDescendants, onFocusRoot, onFocusBranch, onSelectBranch, onSelectSiblings, onSelectAll, onIndent, onOutdent, onCopy, onCut, onPaste, onPasteImage, onResetPosition, onAutoArrange, onRestoreFreeform, onDelete, onDeleteSingle, onResetRelationCurve, onDeleteRelation, hasClipboard, hasFreeformHistory, canOutdent, canIndent, canCreateBoundary, onClose }: ContextMenuProps) {
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

  const estimatedHeight = relation ? 148 : isCanvasMenu ? 386 : 790
  // 顶部工具栏属于更高层的工作区容器；菜单始终留在其下方，避免首项被遮住。
  const menuTop = Math.max(70, Math.min(position.y, window.innerHeight - estimatedHeight - 8))
  const style = {
    left: Math.min(position.x, window.innerWidth - 238),
    top: menuTop,
    maxHeight: window.innerHeight - menuTop - 8,
  }

  return (
    <div ref={menuRef} className="context-menu" style={style} role="menu" onContextMenu={(event) => event.preventDefault()}>
      <p className="context-menu__title">{relation ? '关系线' : isCanvasMenu ? '画布' : isRoot ? '中心主题' : '当前节点'}</p>
      {relation ? (
        <>
          <div className="context-menu__hint">“{relation.label}” · 双击名称编辑，拖动线上的锚点调整弧度</div>
          <div className="context-menu__divider" />
          <MenuItem onClick={onResetRelationCurve} disabled={relation.controlOffsetX === 0 && relation.controlOffsetY === 0}>复位关系线弧度</MenuItem>
          <MenuItem onClick={onDeleteRelation} shortcut="⌫" destructive>删除关系</MenuItem>
        </>
      ) : isCanvasMenu ? (
        <>
          <MenuItem onClick={onAddChild} shortcut="Tab">新建一级节点</MenuItem>
          <MenuItem onClick={onAddFreeTopic}>新建自由主题</MenuItem>
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
      ) : node?.isFreeTopic ? (
        <>
          <MenuItem onClick={onToggleCollapse} shortcut="⌘ /" disabled={!node.childIds.length}>{node.collapsed ? '展开分支' : '折叠分支'}</MenuItem>
          <MenuItem onClick={onCollapseDescendants} disabled={!node.childIds.length}>折叠所有次级分支</MenuItem>
          <MenuItem onClick={onExpandDescendants} disabled={!node.childIds.length}>展开所有次级分支</MenuItem>
          <div className="context-menu__divider" />
          <MenuItem onClick={onAttachToRoot}>附加到主节点</MenuItem>
          <div className="context-menu__hint">自由主题先附加到主节点，之后即可继续新建或粘贴子节点。</div>
          <div className="context-menu__divider" />
          <MenuItem onClick={onEdit} shortcut="F2">编辑主题</MenuItem>
          <div className="context-menu__hint">标记</div>
          {nodeMarkOrder.map((mark) => <MenuItem key={mark} onClick={() => onToggleMark(mark)}>{`${node.marks.includes(mark) ? '✓ ' : ''}${nodeMarkMeta[mark].icon} ${nodeMarkMeta[mark].label}`}</MenuItem>)}
          <MenuItem onClick={onCreateRelation}>创建关系…</MenuItem>
          <MenuItem onClick={onDuplicate} shortcut="⌘ D">复制一个副本</MenuItem>
          <MenuItem onClick={onCopy} shortcut="⌘ C">复制分支</MenuItem>
          <MenuItem onClick={onCut} shortcut="⌘ X">剪切分支</MenuItem>
          <MenuItem onClick={onPasteImage}>粘贴图片</MenuItem>
          <MenuItem onClick={onDelete} shortcut="⌫" destructive>删除分支</MenuItem>
        </>
      ) : node ? (
        <>
          <MenuItem onClick={onAddChild} shortcut="Tab">新建子节点</MenuItem>
          <MenuItem onClick={onAddSibling} shortcut="Enter" disabled={isRoot}>在后方新建同级节点</MenuItem>
          <MenuItem onClick={onAddSiblingBefore} shortcut="⇧ Enter" disabled={isRoot}>在前方新建同级节点</MenuItem>
          <MenuItem onClick={onAddParent} shortcut="⌘ Enter" disabled={isRoot}>插入父节点</MenuItem>
          <div className="context-menu__divider" />
          <MenuItem onClick={onEdit} shortcut="F2">编辑主题</MenuItem>
          <div className="context-menu__hint">标记</div>
          {nodeMarkOrder.map((mark) => <MenuItem key={mark} onClick={() => onToggleMark(mark)}>{`${node.marks.includes(mark) ? '✓ ' : ''}${nodeMarkMeta[mark].icon} ${nodeMarkMeta[mark].label}`}</MenuItem>)}
          <MenuItem onClick={onCreateRelation}>创建关系…</MenuItem>
          <MenuItem onClick={onCreateBoundary} disabled={!canCreateBoundary}>为所选节点创建边界</MenuItem>
          <MenuItem onClick={onCreateSummary} disabled={!canCreateBoundary}>为所选节点创建摘要</MenuItem>
          <MenuItem onClick={onToggleCollapse} shortcut="⌘ /" disabled={!node.childIds.length}>{node.collapsed ? '展开分支' : '折叠分支'}</MenuItem>
          <MenuItem onClick={onCollapseDescendants} disabled={!node.childIds.length}>折叠所有次级分支</MenuItem>
          <MenuItem onClick={onExpandDescendants} disabled={!node.childIds.length}>展开所有次级分支</MenuItem>
          <MenuItem onClick={onFocusRoot}>前往中心主题</MenuItem>
          <MenuItem onClick={onFocusBranch} shortcut="⌘ ;" disabled={isRoot}>仅显示当前分支</MenuItem>
          <div className="context-menu__divider" />
          <MenuItem onClick={onSelectBranch}>选择当前分支</MenuItem>
          <MenuItem onClick={onSelectSiblings} disabled={isRoot}>选择同级节点</MenuItem>
          <MenuItem onClick={onSelectAll} shortcut="⌘ A">选择全部节点</MenuItem>
          <MenuItem onClick={onIndent} shortcut="⌥ →" disabled={!canIndent}>降低层级</MenuItem>
          <MenuItem onClick={onOutdent} shortcut="⇧ Tab" disabled={!canOutdent}>提升层级</MenuItem>
          <div className="context-menu__divider" />
          <MenuItem onClick={onCopy} shortcut="⌘ C">复制分支</MenuItem>
          <MenuItem onClick={onDuplicate} shortcut="⌘ D" disabled={isRoot}>复制一个副本</MenuItem>
          <MenuItem onClick={onCut} shortcut="⌘ X" disabled={isRoot}>剪切分支</MenuItem>
          <MenuItem onClick={onPaste} shortcut="⌘ V" disabled={!hasClipboard}>粘贴为子节点</MenuItem>
          <MenuItem onClick={onPasteImage}>粘贴图片</MenuItem>
          <MenuItem onClick={onResetPosition} shortcut="—">重置节点位置</MenuItem>
          <div className="context-menu__divider" />
          <MenuItem onClick={onAutoArrange}>自动排列</MenuItem>
          <MenuItem onClick={onRestoreFreeform} disabled={!hasFreeformHistory}>恢复自由排布</MenuItem>
          <div className="context-menu__divider" />
          <MenuItem onClick={onDeleteSingle} shortcut="⌘ ⌫" disabled={isRoot}>仅删除当前节点</MenuItem>
          <MenuItem onClick={onDelete} shortcut="⌫" destructive disabled={isRoot}>删除分支</MenuItem>
        </>
      ) : null}
    </div>
  )
}
