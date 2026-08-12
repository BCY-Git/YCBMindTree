/**
 * 轻量、跨导图复用的本地标签库。节点只持有 tagId，避免改名或改色时重写每份导图。
 * 标签库暂不进云端：账号体系稳定后再单独迁移，不能让标签配置阻塞导图同步。
 */
import { randomUuid } from '@/platform/random-uuid'

export type Tag = { id: string; name: string; color: string }

const storageKey = 'mindtree.tags.v1'
const colors = ['#3f8f78', '#d17a42', '#8b6bc7', '#d75a73', '#327fa8', '#998141']

function validTag(value: unknown): value is Tag {
  return Boolean(value && typeof value === 'object'
    && typeof (value as Tag).id === 'string' && typeof (value as Tag).name === 'string' && typeof (value as Tag).color === 'string')
}

export function loadTags(): Tag[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(stored) ? stored.filter(validTag) : []
  } catch {
    return []
  }
}

export function saveTags(tags: Tag[]): void {
  localStorage.setItem(storageKey, JSON.stringify(tags.filter(validTag)))
  window.dispatchEvent(new Event('mindtree:tags-changed'))
}

export function createTag(name: string, color = colors[loadTags().length % colors.length]): Tag {
  return { id: `tag-${randomUuid()}`, name: name.trim() || '未命名标签', color }
}

export function renameTag(id: string, name: string): Tag[] {
  const tags = loadTags().map((tag) => tag.id === id ? { ...tag, name: name.trim() || tag.name } : tag)
  saveTags(tags)
  return tags
}

export function recolorTag(id: string, color: string): Tag[] {
  const tags = loadTags().map((tag) => tag.id === id ? { ...tag, color } : tag)
  saveTags(tags)
  return tags
}

export function deleteTag(id: string): Tag[] {
  const tags = loadTags().filter((tag) => tag.id !== id)
  saveTags(tags)
  return tags
}
