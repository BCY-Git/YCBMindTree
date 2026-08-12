import type { MindMapDocument } from '@/domain/document.types'
import { mindMapDocumentSchema } from '@/domain/document.schema'
import { assertValidDocument } from '@/domain/document.validator'
import { isTauriRuntime } from '@/platform/tauri'
import { randomUuid } from '@/platform/random-uuid'

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

/**
 * 读取 MindTree 自己导出的单图文件。
 * 先校验包装格式，再校验文档 schema 和树结构；不接受任意 JSON，避免坏文件进入工作区。
 */
export function parseDocumentFile(content: string): MindMapDocument {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new Error('文件不是有效的 JSON 导图')
  }
  if (!value || typeof value !== 'object' || !('format' in value) || !('version' in value) || !('document' in value)
    || value.format !== 'mindtree-document' || value.version !== 1) {
    throw new Error('不是受支持的 MindTree 导图文件')
  }
  const document = mindMapDocumentSchema.parse(value.document)
  assertValidDocument(document)
  return structuredClone(document)
}

/** 同 ID 导图导入为副本时，保留图谱内容但切断与原文档、云端版本的身份关联。 */
export function createImportedCopy(document: MindMapDocument, now = Date.now()): MindMapDocument {
  const copy = structuredClone(document)
  return {
    ...copy,
    id: randomUuid(),
    title: `${copy.title}（导入副本）`,
    createdAt: now,
    updatedAt: now,
  }
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
