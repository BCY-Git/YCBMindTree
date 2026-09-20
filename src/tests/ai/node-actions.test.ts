import { describe, expect, it } from 'vitest'
import { aiConfigurationError, buildNodeAiRequest, unwrapNodeAiBranches } from '@/ai/node-actions'
import { defaultAiSettings } from '@/ai/ai-settings'
import { createInitialDocument } from '@/domain/document.factory'
import type { MindNodeClipboard } from '@/domain/commands'

function documentWithChildren() {
  const document = createInitialDocument()
  const root = document.nodes[document.rootId]
  const child = { ...root, id: 'child-1', parentId: root.id, topic: '已有分支', childIds: ['child-2'] }
  const grandChild = { ...root, id: 'child-2', parentId: 'child-1', topic: '已有细节', childIds: [] }
  return {
    ...document,
    nodes: { ...document.nodes, 'child-1': child, 'child-2': grandChild, [root.id]: { ...root, childIds: ['child-1'] } },
  }
}

const branch = (topic: string, children: MindNodeClipboard[] = []): MindNodeClipboard => ({
  topic, note: '', links: [], attachments: [], taskStatus: 'none', priority: 0, dueDate: null, marks: [], tagIds: [], collapsed: false, children,
})

describe('node AI actions', () => {
  it('reports missing configuration before any request', () => {
    expect(aiConfigurationError({ ...defaultAiSettings, endpoint: '', model: '', apiKey: '' }, true)).toContain('配置模型')
    expect(aiConfigurationError({ ...defaultAiSettings, endpoint: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '' }, true)).toBeNull()
    expect(aiConfigurationError({ ...defaultAiSettings, endpoint: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '' }, false)).toContain('API Key')
  })

  it('builds expand-branch request with path context and existing children', () => {
    const document = documentWithChildren()
    const { system, user } = buildNodeAiRequest(document, 'child-1', 'expand-branch')
    expect(system).toContain('分支树')
    const context = JSON.parse(user) as { path: string[]; topic: string; existingChildren: string[] }
    expect(context.topic).toBe('已有分支')
    expect(context.path.at(-1)).toBe('已有分支')
    expect(context.existingChildren).toEqual(['已有细节'])
  })

  it('includes a subtree outline for summarize and merges custom prompts', () => {
    const document = documentWithChildren()
    const { system, user } = buildNodeAiRequest(document, document.rootId, 'summarize', '用一句话概括')
    expect(system).toContain('总结')
    expect(user).toContain('- 已有分支')
    expect(user).toContain('- 已有细节')
    expect(user).toContain('用一句话概括')
  })

  it('requires todo status in the tasks protocol', () => {
    const document = documentWithChildren()
    const { system } = buildNodeAiRequest(document, 'child-1', 'tasks')
    expect(system).toContain('taskStatus')
    expect(system).toContain('todo')
  })

  it('throws for a missing node', () => {
    const document = createInitialDocument()
    expect(() => buildNodeAiRequest(document, 'missing', 'expand-branch')).toThrow('不存在')
  })

  it('unwraps the echo root for expand-branch and tasks but keeps the summarize root', () => {
    const children = [branch('方向A', [branch('子点A1')]), branch('方向B')]
    const root = branch('当前主题原文', children)
    expect(unwrapNodeAiBranches(root, 'expand-branch')).toEqual(children)
    expect(unwrapNodeAiBranches(root, 'tasks')).toEqual(children)
    expect(unwrapNodeAiBranches(root, 'summarize')).toEqual([root])
    expect(unwrapNodeAiBranches(branch('单点'), 'expand-branch')).toEqual([branch('单点')])
  })
})
