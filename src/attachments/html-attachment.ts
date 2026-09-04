/**
 * HTML 附件的纯工具函数 — 拖放识别、类型归一化和桌面预览地址。
 *
 * 安全边界：预览永远在 sandbox="allow-scripts" 的透明 origin iframe 里运行，
 * 这里的函数只负责判断"是不是 HTML"和"地址长什么样"，不做任何内容处理。
 */

export const MAX_HTML_ATTACHMENT_SIZE = 15 * 1024 * 1024

const HTML_EXTENSIONS = ['.html', '.htm']

export function isHtmlFileName(name: string): boolean {
  const lowered = name.toLowerCase()
  return HTML_EXTENSIONS.some((extension) => lowered.endsWith(extension))
}

/** macOS Finder 通常给 text/html；部分来源只给扩展名，甚至给空 MIME，都按扩展名兜底。 */
export function isHtmlFile(file: { name: string; type: string }): boolean {
  return file.type === 'text/html' || isHtmlFileName(file.name)
}

/**
 * 归一化成稳定的 text/html 附件：布局与渲染都以 `type === 'text/html'` 识别，
 * 扩展名缺失时补 .html，MIME 缺失或错误时强制纠正，其余文件原样返回。
 */
export function normalizeHtmlFile(file: File): File {
  const byExtension = isHtmlFileName(file.name)
  const byType = file.type === 'text/html'
  if (!byExtension && !byType) return file
  if (byExtension && byType) return file
  const name = byExtension ? file.name : `${file.name}.html`
  return new File([file], name, { type: 'text/html' })
}

/** 预览编号与 Rust 侧 is_safe_preview_id 对齐：UUID 字符集，杜绝路径穿越。 */
export function sanitizePreviewId(id: string): string | null {
  return /^[\w-]{1,64}$/.test(id) ? id : null
}

/**
 * 桌面端 iframe 不用 blob:（会被主应用 CSP 拦截并继承严格策略禁掉内联脚本），
 * 改走自定义协议；wry 在 Windows 上把自定义协议映射为 http://<scheme>.localhost。
 */
export function desktopPreviewUrl(id: string): string | null {
  const safe = sanitizePreviewId(id)
  if (!safe) return null
  const isWindows = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent)
  return isWindows
    ? `http://mindtree-preview.localhost/${safe}.html`
    : `mindtree-preview://localhost/${safe}.html`
}

/** IndexedDB 里的 Blob 转 base64，走 Tauri IPC 写入原生预览缓存。 */
export function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('无法读取 HTML 文件内容'))
    reader.readAsDataURL(blob)
  })
}
