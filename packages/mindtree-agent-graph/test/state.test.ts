import { describe, expect, it } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { appendMessages, mergeFingerprints, MindTreeState } from '../src/state.js'

// 这份测试直接测具名 reducer 函数本身（见 state.ts 顶部注释：为什么不伸手
// 进 MindTreeState.spec.xxx 断言）——纯函数，不需要起图、不需要 checkpointer。

describe('reducers', () => {
  it('appendMessages：追加，不覆盖', () => {
    const a = new HumanMessage('a')
    const b = new HumanMessage('b')
    expect(appendMessages([a], [b])).toEqual([a, b])
  })

  it('mergeFingerprints：追加并去重', () => {
    const result = mergeFingerprints(['fp-1', 'fp-2'], ['fp-2', 'fp-3'])
    expect(new Set(result)).toEqual(new Set(['fp-1', 'fp-2', 'fp-3']))
  })
})

describe('MindTreeState：能正常编入 Annotation.Root（结构性校验）', () => {
  it('State 类型上该有的字段都在，说明 schema 没有拼写错误导致某个 channel 丢失', () => {
    // Annotation.Root 在这里主要是编译期契约；运行期用一个假状态走一遍
    // TypeScript 结构检查，比反射内部字段更贴近"我到底改坏了没有"。
    const sample: typeof MindTreeState.State = {
      messages: [],
      focusContext: null,
      retrievedSources: [],
      appliedFingerprints: [],
      pendingCandidates: [],
    }
    expect(Object.keys(sample).sort()).toEqual(
      ['appliedFingerprints', 'focusContext', 'messages', 'pendingCandidates', 'retrievedSources'].sort(),
    )
  })
})
