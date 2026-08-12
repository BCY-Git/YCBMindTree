import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { MobileMoreMenu } from '../../app/MobileMoreMenu'
import { emptyNodeFilter } from '../../editor/filter-store'

beforeAll(() => {
  if (!window.PointerEvent) Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent })
})

function renderMenu(overrides: Partial<ComponentProps<typeof MobileMoreMenu>> = {}) {
  const props: ComponentProps<typeof MobileMoreMenu> = {
    canUndo: true,
    canRedo: true,
    canAddSibling: true,
    canCreateRelation: true,
    canGroupSelection: true,
    canArrange: true,
    canFocus: true,
    focusActive: false,
    relationLabel: '建立联系',
    viewIsOutline: false,
    tags: [{ id: 'tag-1', name: '重点', color: '#47766a' }],
    filter: emptyNodeFilter,
    signedIn: false,
    isDraft: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onAddSibling: vi.fn(),
    onCreateRelation: vi.fn(),
    onCreateSummary: vi.fn(),
    onCreateBoundary: vi.fn(),
    onArrange: vi.fn(),
    onToggleFocus: vi.fn(),
    onToggleView: vi.fn(),
    onSaveFile: vi.fn(),
    onOpenHistory: vi.fn(),
    onStartPresentation: vi.fn(),
    onFilterChange: vi.fn(),
    onClearFilter: vi.fn(),
    onExportSvg: vi.fn(),
    onExportOpml: vi.fn(),
    onExportMarkdown: vi.fn(),
    onExportWorkspaceBackup: vi.fn(),
    onLogin: vi.fn(),
    onSync: vi.fn(),
    onDeleteDraft: vi.fn(),
    onSaveDraft: vi.fn(),
    ...overrides,
  }
  render(<MobileMoreMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '更多功能' }))
  return props
}

describe('MobileMoreMenu', () => {
  it('keeps every desktop toolbar group reachable on narrow screens', () => {
    renderMenu()

    expect(screen.getByRole('dialog', { name: '全部功能' })).toBeTruthy()
    for (const name of ['撤销', '重做', '同级节点', '建立联系', '创建摘要', '创建边界', '自动排列', '聚焦分支', '大纲视图', '保存文件', '版本历史', '开始演示']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    expect(screen.getByText('筛选与高亮')).toBeTruthy()
    expect(screen.getByText('导出与备份')).toBeTruthy()
    expect(screen.getByRole('button', { name: '登录或注册账号' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '云端同步配置' })).toBeTruthy()
  })

  it('runs an action and returns to the canvas', () => {
    const onSaveFile = vi.fn()
    renderMenu({ onSaveFile })

    fireEvent.click(screen.getByRole('button', { name: '保存文件' }))

    expect(onSaveFile).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: '全部功能' })).toBeNull()
  })

  it('allows filters to be changed without closing the sheet', () => {
    const onFilterChange = vi.fn()
    renderMenu({ onFilterChange })

    fireEvent.click(screen.getByText('筛选与高亮'))
    fireEvent.click(screen.getByRole('button', { name: '重点' }))

    expect(onFilterChange).toHaveBeenCalledWith({ ...emptyNodeFilter, tags: ['tag-1'] })
    expect(screen.getByRole('dialog', { name: '全部功能' })).toBeTruthy()
  })
})
