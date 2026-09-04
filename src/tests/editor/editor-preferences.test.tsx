import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorPreferencesDialog } from '../../editor/EditorPreferencesDialog'
import { defaultEditorPreferences, loadEditorPreferences, saveEditorPreferences } from '../../editor/editor-preferences'

afterEach(() => localStorage.clear())

describe('editor preferences persistence', () => {
  it('uses safe defaults for missing or malformed storage', () => {
    expect(loadEditorPreferences()).toEqual(defaultEditorPreferences)
    localStorage.setItem('mindtree.editor-preferences.v1', '{broken')
    expect(loadEditorPreferences()).toEqual(defaultEditorPreferences)
  })

  it('round-trips the toolbar timing and add-button choice', () => {
    const preferences = { floatingToolbarVisibility: 'hover' as const, showAddTopicButtons: false }
    saveEditorPreferences(preferences)
    expect(loadEditorPreferences()).toEqual(preferences)
  })
})

describe('EditorPreferencesDialog', () => {
  it('emits each preference change and closes with Escape', () => {
    const onChange = vi.fn()
    const onClose = vi.fn()
    render(<EditorPreferencesDialog open preferences={defaultEditorPreferences} onChange={onChange} onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('显示浮动工具栏'), { target: { value: 'never' } })
    expect(onChange).toHaveBeenCalledWith({ ...defaultEditorPreferences, floatingToolbarVisibility: 'never' })

    fireEvent.click(screen.getByRole('switch', { name: '显示添加主题按钮' }))
    expect(onChange).toHaveBeenCalledWith({ ...defaultEditorPreferences, showAddTopicButtons: false })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
