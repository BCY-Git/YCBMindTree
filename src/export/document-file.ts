import type { MindMapDocument } from '../domain/document.types'
import { isTauriRuntime } from '../platform/tauri'

type FilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }>
}

export type LocalFileSaveResult = 'native' | 'picker' | 'download'

function safeFileName(title: string) {
  return (title.trim() || '未命名导图').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
}

/** 可恢复的本地导图文件；附件 Blob 仍保留在 IndexedDB，不会被序列化进文件。 */
export function serializeDocumentFile(document: MindMapDocument) {
  return JSON.stringify({
    format: 'mindtree-document',
    version: 1,
    exportedAt: new Date().toISOString(),
    document,
  }, null, 2)
}

export async function saveDocumentToLocalFile(document: MindMapDocument): Promise<LocalFileSaveResult> {
  const content = serializeDocumentFile(document)
  const suggestedName = `${safeFileName(document.title)}.mindtree.json`
  if (isTauriRuntime()) {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ])
    const path = await save({
      title: '保存 MindTree 导图', defaultPath: suggestedName,
      filters: [{ name: 'MindTree 导图文件', extensions: ['mindtree.json', 'json'] }],
    })
    if (!path) throw new DOMException('用户取消保存', 'AbortError')
    await writeTextFile(path, content)
    return 'native'
  }
  const picker = (window as FilePickerWindow).showSaveFilePicker
  if (picker) {
    const handle = await picker({
      suggestedName,
      types: [{ description: 'MindTree 导图文件', accept: { 'application/json': ['.mindtree.json', '.json'] } }],
    })
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
    return 'picker'
  }

  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url
  link.download = suggestedName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return 'download'
}
