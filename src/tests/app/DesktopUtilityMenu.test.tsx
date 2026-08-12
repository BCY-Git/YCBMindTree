import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DesktopUtilityMenu } from '../../app/DesktopUtilityMenu'

beforeAll(() => {
  if (!window.PointerEvent) Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent })
})

function renderMenu(overrides: Partial<ComponentProps<typeof DesktopUtilityMenu>> = {}) {
  const props: ComponentProps<typeof DesktopUtilityMenu> = {
    viewIsOutline: false,
    sidebarCollapsed: false,
    inspectorCollapsed: true,
    signedIn: false,
    isDraft: false,
    onToggleView: vi.fn(),
    onSaveFile: vi.fn(),
    onOpenHistory: vi.fn(),
    onStartPresentation: vi.fn(),
    onExportSvg: vi.fn(),
    onExportOpml: vi.fn(),
    onExportMarkdown: vi.fn(),
    onExportWorkspaceBackup: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleInspector: vi.fn(),
    onLogin: vi.fn(),
    onSync: vi.fn(),
    onDeleteDraft: vi.fn(),
    onSaveDraft: vi.fn(),
    ...overrides,
  }
  render(<DesktopUtilityMenu {...props} />)
  fireEvent.pointerDown(screen.getByRole('button', { name: '更多工作区功能' }), { button: 0, ctrlKey: false })
  return props
}

describe('DesktopUtilityMenu', () => {
  it('keeps low-frequency workspace actions reachable in one menu', () => {
    renderMenu()

    expect(screen.getByRole('menu', { name: '更多工作区功能' })).toBeTruthy()
    for (const name of ['保存到本机文件', '版本历史', '开始演示', '导出与备份', '布局与面板', '登录或注册账号', '云端同步配置']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })

  it('runs a selected action and closes the menu', () => {
    const onSaveFile = vi.fn()
    renderMenu({ onSaveFile })

    fireEvent.click(screen.getByRole('menuitem', { name: /保存到本机文件/ }))

    expect(onSaveFile).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu', { name: '更多工作区功能' })).toBeNull()
  })
})
