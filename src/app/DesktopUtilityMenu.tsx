import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import {
  ArchiveIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  DashboardIcon,
  DownloadIcon,
  DotsHorizontalIcon,
  FileIcon,
  FileTextIcon,
  PersonIcon,
  PlayIcon,
  ReaderIcon,
  UpdateIcon,
} from '@radix-ui/react-icons'

type DesktopUtilityMenuProps = {
  viewIsOutline: boolean
  sidebarCollapsed: boolean
  inspectorCollapsed: boolean
  signedIn: boolean
  isDraft: boolean
  onToggleView: () => void
  onSaveFile: () => void
  onOpenHistory: () => void
  onStartPresentation: () => void
  onExportSvg: (transparent?: boolean) => void
  onExportOpml: () => void
  onExportMarkdown: (mode: 'outline' | 'minutes' | 'tasks' | 'ai-context') => void
  onExportWorkspaceBackup: () => void
  onToggleSidebar: () => void
  onToggleInspector: () => void
  onLogin: () => void
  onSync: () => void
  onDeleteDraft: () => void
  onSaveDraft: () => void
}

function MenuItem({ children, onSelect, danger = false }: { children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return <DropdownMenu.Item className={`desktop-utility-menu__item ${danger ? 'is-danger' : ''}`} onSelect={onSelect}>{children}</DropdownMenu.Item>
}

export function DesktopUtilityMenu(props: DesktopUtilityMenuProps) {
  const closeAnd = (action: () => void) => () => action()

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="topbar-utility__button desktop-topbar-more" type="button" title="更多工作区功能" aria-label="更多工作区功能"><span aria-hidden="true" className="toolbar-icon"><DotsHorizontalIcon /></span></button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="desktop-utility-menu" sideOffset={8} align="end" aria-label="更多工作区功能">
          <DropdownMenu.Label className="desktop-utility-menu__label">工作区</DropdownMenu.Label>
          <MenuItem onSelect={closeAnd(props.onToggleView)}><span>{props.viewIsOutline ? <DashboardIcon /> : <ReaderIcon />}</span>{props.viewIsOutline ? '切换到导图视图' : '切换到大纲视图'}</MenuItem>
          <MenuItem onSelect={closeAnd(props.onSaveFile)}><span><FileIcon /></span>保存到本机文件 <kbd>⌘S</kbd></MenuItem>
          <MenuItem onSelect={closeAnd(props.onOpenHistory)}><span><ClockIcon /></span>版本历史</MenuItem>
          <MenuItem onSelect={closeAnd(props.onStartPresentation)}><span><PlayIcon /></span>开始演示</MenuItem>

          <DropdownMenu.Separator className="desktop-utility-menu__separator" />
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="desktop-utility-menu__item"><span><DownloadIcon /></span>导出与备份 <ChevronRightIcon className="desktop-utility-menu__chevron" /></DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="desktop-utility-menu" sideOffset={6} alignOffset={-4}>
                <DropdownMenu.Label className="desktop-utility-menu__label">导出当前导图</DropdownMenu.Label>
                <MenuItem onSelect={closeAnd(() => props.onExportSvg())}><span><DownloadIcon /></span>完整导图 SVG</MenuItem>
                <MenuItem onSelect={closeAnd(() => props.onExportSvg(true))}><span><DownloadIcon /></span>透明背景 SVG</MenuItem>
                <MenuItem onSelect={closeAnd(props.onExportOpml)}><span><FileTextIcon /></span>OPML 大纲</MenuItem>
                <MenuItem onSelect={closeAnd(() => props.onExportMarkdown('outline'))}><span><FileTextIcon /></span>Markdown 大纲</MenuItem>
                <MenuItem onSelect={closeAnd(() => props.onExportMarkdown('minutes'))}><span><FileTextIcon /></span>会议纪要</MenuItem>
                <MenuItem onSelect={closeAnd(() => props.onExportMarkdown('tasks'))}><span><FileTextIcon /></span>任务清单</MenuItem>
                <MenuItem onSelect={closeAnd(() => props.onExportMarkdown('ai-context'))}><span><FileTextIcon /></span>AI 上下文</MenuItem>
                <DropdownMenu.Separator className="desktop-utility-menu__separator" />
                <MenuItem onSelect={closeAnd(props.onExportWorkspaceBackup)}><span><ArchiveIcon /></span>导出工作区备份</MenuItem>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="desktop-utility-menu__item"><span><DashboardIcon /></span>布局与面板 <ChevronRightIcon className="desktop-utility-menu__chevron" /></DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="desktop-utility-menu" sideOffset={6} alignOffset={-4}>
                <DropdownMenu.CheckboxItem className="desktop-utility-menu__item" checked={!props.sidebarCollapsed} onSelect={closeAnd(props.onToggleSidebar)}><span><DashboardIcon /></span>显示导图侧栏 <DropdownMenu.ItemIndicator className="desktop-utility-menu__check"><CheckIcon /></DropdownMenu.ItemIndicator></DropdownMenu.CheckboxItem>
                <DropdownMenu.CheckboxItem className="desktop-utility-menu__item" checked={!props.inspectorCollapsed} onSelect={closeAnd(props.onToggleInspector)}><span><DashboardIcon /></span>显示属性面板 <DropdownMenu.ItemIndicator className="desktop-utility-menu__check"><CheckIcon /></DropdownMenu.ItemIndicator></DropdownMenu.CheckboxItem>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          <DropdownMenu.Separator className="desktop-utility-menu__separator" />
          {!props.signedIn && <MenuItem onSelect={closeAnd(props.onLogin)}><span><PersonIcon /></span>登录或注册账号</MenuItem>}
          <MenuItem onSelect={closeAnd(props.onSync)}><span><UpdateIcon /></span>{props.signedIn ? '同步账号导图库' : '云端同步配置'}</MenuItem>

          {props.isDraft && <>
            <DropdownMenu.Separator className="desktop-utility-menu__separator" />
            <DropdownMenu.Label className="desktop-utility-menu__label">随手记</DropdownMenu.Label>
            <MenuItem onSelect={closeAnd(props.onSaveDraft)}><span><FileIcon /></span>保存为正式导图</MenuItem>
            <MenuItem danger onSelect={closeAnd(props.onDeleteDraft)}><span>×</span>删除这份随手记</MenuItem>
          </>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
