export type ClipboardImageData = {
  items?: ArrayLike<Pick<DataTransferItem, 'type' | 'getAsFile'>> | null
  files?: ArrayLike<File> | null
}

export type ClipboardImageReader = {
  read: () => Promise<ArrayLike<{
    types: ArrayLike<string>
    getType: (type: string) => Promise<Blob>
  }>>
}

const imageMimeByExtension: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

function normalizeImageFile(file: File | null): File | null {
  if (!file) return null
  if (file.type.startsWith('image/')) return file
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const inferredType = imageMimeByExtension[extension]
  return inferredType ? new File([file], file.name, { type: inferredType, lastModified: file.lastModified }) : null
}

function extensionForImageMime(type: string): string {
  if (type === 'image/jpeg') return 'jpg'
  if (type === 'image/svg+xml') return 'svg'
  return type.slice('image/'.length).split(/[;+]/, 1)[0] || 'png'
}

/** 兼容浏览器截图（items）与 macOS/Finder 文件复制（files）两种剪贴板形态。 */
export function findClipboardImageFile(data: ClipboardImageData | null | undefined): File | null {
  for (const item of Array.from(data?.items ?? [])) {
    const image = normalizeImageFile(item.getAsFile())
    if (image) return image
  }
  for (const file of Array.from(data?.files ?? [])) {
    const image = normalizeImageFile(file)
    if (image) return image
  }
  return null
}

/** WebKit 有时只保留 image MIME 提示，但同步 getAsFile() 会返回 null。 */
export function hasClipboardImageHint(data: ClipboardImageData | null | undefined): boolean {
  return Array.from(data?.items ?? []).some((item) => item.type.startsWith('image/'))
}

/**
 * 先读取事件自带的 File；若 WebKit 只给出 MIME 提示，再从 Async Clipboard API 取得真实字节。
 * 权限被拒绝时返回 null，由界面给用户可操作的错误提示。
 */
export async function readClipboardImageFile(
  data: ClipboardImageData | null | undefined,
  reader: ClipboardImageReader | null | undefined,
): Promise<File | null> {
  const directImage = findClipboardImageFile(data)
  if (directImage) return directImage
  if (!reader) return null

  try {
    const clipboardItems = Array.from(await reader.read())
    for (const item of clipboardItems) {
      const imageType = Array.from(item.types).find((type) => type.startsWith('image/'))
      if (!imageType) continue
      const blob = await item.getType(imageType)
      const type = blob.type.startsWith('image/') ? blob.type : imageType
      return new File([blob], `粘贴图片.${extensionForImageMime(type)}`, { type })
    }
  } catch {
    return null
  }
  return null
}
