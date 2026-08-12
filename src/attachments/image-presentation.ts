import type { MindNodeAttachmentImage } from '../domain/document.types'

const MIN_IMAGE_WIDTH = 120
const MAX_IMAGE_WIDTH = 480

export function clampImageDisplayWidth(width: number): number {
  return Math.round(Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, width)))
}

export function imageDisplayHeight(image: MindNodeAttachmentImage | undefined): number {
  if (!image || image.width <= 0 || image.height <= 0) return 96
  return Math.round(image.displayWidth * image.height / image.width)
}

/** 读取文件的像素尺寸；失败时让调用方按普通附件处理。 */
export async function readImagePresentation(file: File): Promise<MindNodeAttachmentImage | null> {
  if (!file.type.startsWith('image/')) return null
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('无法读取图片尺寸'))
      element.src = url
    })
    if (!image.naturalWidth || !image.naturalHeight) return null
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      displayWidth: clampImageDisplayWidth(Math.min(image.naturalWidth, 260)),
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
