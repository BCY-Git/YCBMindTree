export type ClipboardImageData = {
  items?: ArrayLike<Pick<DataTransferItem, 'type' | 'getAsFile'>> | null
  files?: ArrayLike<File> | null
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
