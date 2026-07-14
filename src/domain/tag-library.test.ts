import { beforeEach, describe, expect, it } from 'vitest'
import { createTag, deleteTag, loadTags, renameTag, saveTags } from './tag-library'

describe('tag library', () => {
  beforeEach(() => localStorage.clear())

  it('persists reusable tags and keeps their ids stable when renamed', () => {
    const tag = createTag('工作')
    saveTags([tag])
    renameTag(tag.id, '待确认')

    expect(loadTags()).toEqual([{ ...tag, name: '待确认' }])
    deleteTag(tag.id)
    expect(loadTags()).toEqual([])
  })
})
