import * as Dialog from '@radix-ui/react-dialog'
import type { CSSProperties, ReactNode } from 'react'
import {
  ClockIcon,
  Cross2Icon,
  DashboardIcon,
  DownloadIcon,
  DotsHorizontalIcon,
  EnterIcon,
  FileIcon,
  Link2Icon,
  MixerHorizontalIcon,
  PersonIcon,
  PlayIcon,
  ReaderIcon,
  ReloadIcon,
  ResetIcon,
  RotateCounterClockwiseIcon,
  TargetIcon,
  UpdateIcon,
} from '@radix-ui/react-icons'
import type { Tag } from '../domain/tag-library'
import { nodeMarkMeta, nodeMarkOrder } from '../domain/node-semantics'
import type { NodeFilter } from '../editor/filter-store'

function SummaryIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h3c2.2 0 3.4 1.2 3.4 3.4v7.2C10.4 17.8 11.6 19 14 19" /><rect x="14" y="9" width="7" height="6" rx="1.5" /></svg>
}

function BoundaryIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5" strokeDasharray="2.5 2.5" /></svg>
}

type MobileMoreMenuProps = {
  canUndo: boolean
  canRedo: boolean
  canAddSibling: boolean
  canCreateRelation: boolean
  canGroupSelection: boolean
  canArrange: boolean
  canFocus: boolean
  focusActive: boolean
  relationLabel: string
  viewIsOutline: boolean
  tags: Tag[]
  filter: NodeFilter
  signedIn: boolean
  isDraft: boolean
  themeStyle?: CSSProperties
  onUndo: () => void
  onRedo: () => void
  onAddSibling: () => void
  onCreateRelation: () => void
  onCreateSummary: () => void
  onCreateBoundary: () => void
  onArrange: () => void
  onToggleFocus: () => void
  onToggleView: () => void
  onSaveFile: () => void
  onOpenHistory: () => void
  onStartPresentation: () => void
  onFilterChange: (filter: NodeFilter) => void
  onClearFilter: () => void
  onExportSvg: (transparent?: boolean) => void
  onExportOpml: () => void
  onExportMarkdown: (mode: 'outline' | 'minutes' | 'tasks' | 'ai-context') => void
  onExportWorkspaceBackup: () => void
  onLogin: () => void
  onSync: () => void
  onDeleteDraft: () => void
  onSaveDraft: () => void
}

function toggleValue<T>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

export function MobileMoreMenu(props: MobileMoreMenuProps) {
  const hasFilter = props.filter.tags.length > 0 || props.filter.marks.length > 0 || props.filter.statuses.length > 0 || props.filter.priorities.length > 0
  const closeAction = (label: string, icon: ReactNode, onClick: () => void, disabled = false, active = false) => (
    <Dialog.Close asChild>
      <button className={`mobile-tools__action ${active ? 'is-active' : ''}`} type="button" onClick={onClick} disabled={disabled}>
        <span>{icon}</span><strong>{label}</strong>
      </button>
    </Dialog.Close>
  )

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button className="topbar-utility__button topbar-mobile-action mobile-more-trigger" type="button" title="更多功能" aria-label="更多功能">
          <span aria-hidden="true" className="toolbar-icon"><DotsHorizontalIcon /></span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
      <Dialog.Overlay className="mobile-tools__overlay" />
      <Dialog.Content className="mobile-tools" style={props.themeStyle} aria-describedby="mobile-tools-description">
        <header className="mobile-tools__header">
          <div><Dialog.Title>全部功能</Dialog.Title><Dialog.Description id="mobile-tools-description">桌面工具在手机上的完整入口</Dialog.Description></div>
          <Dialog.Close asChild><button type="button" aria-label="关闭全部功能"><Cross2Icon /></button></Dialog.Close>
        </header>

        <div className="mobile-tools__scroll">
          <section className="mobile-tools__section" aria-labelledby="mobile-tools-editing">
            <h3 id="mobile-tools-editing">编辑</h3>
            <div className="mobile-tools__grid">
              {closeAction('撤销', <RotateCounterClockwiseIcon />, props.onUndo, !props.canUndo)}
              {closeAction('重做', <ResetIcon />, props.onRedo, !props.canRedo)}
              {closeAction('同级节点', <EnterIcon />, props.onAddSibling, !props.canAddSibling)}
              {closeAction(props.relationLabel, <Link2Icon />, props.onCreateRelation, !props.canCreateRelation)}
              {closeAction('创建摘要', <SummaryIcon />, props.onCreateSummary, !props.canGroupSelection)}
              {closeAction('创建边界', <BoundaryIcon />, props.onCreateBoundary, !props.canGroupSelection)}
              {closeAction('自动排列', <ReloadIcon />, props.onArrange, !props.canArrange)}
              {closeAction(props.focusActive ? '退出聚焦' : '聚焦分支', <TargetIcon />, props.onToggleFocus, !props.canFocus, props.focusActive)}
            </div>
          </section>

          <section className="mobile-tools__section" aria-labelledby="mobile-tools-file">
            <h3 id="mobile-tools-file">文件与视图</h3>
            <div className="mobile-tools__grid">
              {closeAction(props.viewIsOutline ? '导图视图' : '大纲视图', props.viewIsOutline ? <DashboardIcon /> : <ReaderIcon />, props.onToggleView)}
              {closeAction('保存文件', <FileIcon />, props.onSaveFile)}
              {closeAction('版本历史', <ClockIcon />, props.onOpenHistory)}
              {closeAction('开始演示', <PlayIcon />, props.onStartPresentation)}
            </div>
          </section>

          <details className="mobile-tools__details">
            <summary><span><MixerHorizontalIcon />筛选与高亮</span>{hasFilter && <i>已启用</i>}</summary>
            <div className="mobile-tools__filters">
              {hasFilter && <button className="mobile-tools__clear" type="button" onClick={props.onClearFilter}>清除全部筛选</button>}
              {props.tags.length > 0 && <fieldset><legend>标签</legend><div>{props.tags.map((tag) => <button key={tag.id} type="button" className={props.filter.tags.includes(tag.id) ? 'is-selected' : ''} onClick={() => props.onFilterChange({ ...props.filter, tags: toggleValue(props.filter.tags, tag.id) })}><i style={{ background: tag.color }} />{tag.name}</button>)}</div></fieldset>}
              <fieldset><legend>标记</legend><div>{nodeMarkOrder.map((mark) => <button key={mark} type="button" className={props.filter.marks.includes(mark) ? 'is-selected' : ''} onClick={() => props.onFilterChange({ ...props.filter, marks: toggleValue(props.filter.marks, mark) })}>{nodeMarkMeta[mark].icon} {nodeMarkMeta[mark].label}</button>)}</div></fieldset>
              <fieldset><legend>任务状态</legend><div>{([['todo', '待办'], ['doing', '进行中'], ['done', '已完成']] as const).map(([status, label]) => <button key={status} type="button" className={props.filter.statuses.includes(status) ? 'is-selected' : ''} onClick={() => props.onFilterChange({ ...props.filter, statuses: toggleValue(props.filter.statuses, status) })}>{label}</button>)}</div></fieldset>
              <fieldset><legend>优先级</legend><div>{([1, 2, 3] as const).map((priority) => <button key={priority} type="button" className={props.filter.priorities.includes(priority) ? 'is-selected' : ''} onClick={() => props.onFilterChange({ ...props.filter, priorities: toggleValue(props.filter.priorities, priority) })}>P{priority}</button>)}</div></fieldset>
            </div>
          </details>

          <details className="mobile-tools__details">
            <summary><span><DownloadIcon />导出与备份</span></summary>
            <div className="mobile-tools__list">
              {closeAction('完整导图 SVG', <DownloadIcon />, () => props.onExportSvg())}
              {closeAction('透明背景 SVG', <DownloadIcon />, () => props.onExportSvg(true))}
              {closeAction('OPML 大纲', <DownloadIcon />, props.onExportOpml)}
              {closeAction('Markdown 大纲', <DownloadIcon />, () => props.onExportMarkdown('outline'))}
              {closeAction('会议纪要', <DownloadIcon />, () => props.onExportMarkdown('minutes'))}
              {closeAction('任务清单', <DownloadIcon />, () => props.onExportMarkdown('tasks'))}
              {closeAction('AI 上下文', <DownloadIcon />, () => props.onExportMarkdown('ai-context'))}
              {closeAction('工作区备份', <DownloadIcon />, props.onExportWorkspaceBackup)}
            </div>
          </details>

          <section className="mobile-tools__section" aria-labelledby="mobile-tools-account">
            <h3 id="mobile-tools-account">账号与同步</h3>
            <div className="mobile-tools__list">
              {!props.signedIn && closeAction('登录或注册账号', <PersonIcon />, props.onLogin)}
              {closeAction(props.signedIn ? '同步账号导图库' : '云端同步配置', <UpdateIcon />, props.onSync)}
            </div>
          </section>

          {props.isDraft && <section className="mobile-tools__section mobile-tools__section--draft" aria-labelledby="mobile-tools-draft">
            <h3 id="mobile-tools-draft">随手记</h3>
            <div className="mobile-tools__list">
              {closeAction('保存为正式导图', <FileIcon />, props.onSaveDraft)}
              {closeAction('删除这份随手记', <Cross2Icon />, props.onDeleteDraft)}
            </div>
          </section>}
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
