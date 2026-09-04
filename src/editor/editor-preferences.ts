export type FloatingToolbarVisibility = 'always' | 'hover' | 'never'

export type EditorPreferences = {
  floatingToolbarVisibility: FloatingToolbarVisibility
  showAddTopicButtons: boolean
}

export const defaultEditorPreferences: EditorPreferences = {
  floatingToolbarVisibility: 'always',
  showAddTopicButtons: true,
}

const editorPreferencesStorageKey = 'mindtree.editor-preferences.v1'

function isToolbarVisibility(value: unknown): value is FloatingToolbarVisibility {
  return value === 'always' || value === 'hover' || value === 'never'
}

export function loadEditorPreferences(): EditorPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(editorPreferencesStorageKey) ?? '{}') as Partial<EditorPreferences>
    return {
      floatingToolbarVisibility: isToolbarVisibility(stored.floatingToolbarVisibility)
        ? stored.floatingToolbarVisibility
        : defaultEditorPreferences.floatingToolbarVisibility,
      showAddTopicButtons: typeof stored.showAddTopicButtons === 'boolean'
        ? stored.showAddTopicButtons
        : defaultEditorPreferences.showAddTopicButtons,
    }
  } catch {
    return defaultEditorPreferences
  }
}

export function saveEditorPreferences(preferences: EditorPreferences) {
  localStorage.setItem(editorPreferencesStorageKey, JSON.stringify(preferences))
}
