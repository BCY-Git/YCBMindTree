export type ExportFileRequest = {
  content: string | Uint8Array
  suggestedName: string
  dialogTitle: string
  typeName: string
  extensions: string[]
  mimeType: string
}

export type ExportFileResult = {
  method: 'native' | 'picker' | 'download'
  fileName: string
  path?: string
}

export function exportFileStatus(result: ExportFileResult): string {
  if (result.path) return `已导出到：${result.path}`
  if (result.method === 'download') return `已下载到浏览器默认目录：${result.fileName}`
  return `已导出：${result.fileName}`
}

export async function revealExportFile(path: string): Promise<void> {
  if (!isTauriRuntime()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('reveal_export_in_finder', { path })
}

/** 保存导出产物；桌面端使用原生保存面板，浏览器环境回退为标准下载。 */
export async function saveExportFile(request: ExportFileRequest): Promise<ExportFileResult> {
  if (isTauriRuntime()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ])
    const path = await save({
      title: request.dialogTitle,
      defaultPath: request.suggestedName,
      filters: [{ name: request.typeName, extensions: request.extensions }],
    })
    if (!path) throw new DOMException('用户取消导出', 'AbortError')
    const bytes = typeof request.content === 'string' ? new TextEncoder().encode(request.content) : request.content
    await writeFile(path, bytes)
    return { method: 'native', fileName: request.suggestedName, path }
  }
  const blob = new Blob([request.content as BlobPart], { type: request.mimeType })
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url
  link.download = request.suggestedName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return { method: 'download', fileName: request.suggestedName }
}
import { isTauriRuntime } from '@/platform/tauri'
