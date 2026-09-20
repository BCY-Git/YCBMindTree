import { describe, expect, it } from 'vitest'
import { drainSseBuffer, readSseStream } from '@/platform/ai-stream'

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe('ai-stream SSE parsing', () => {
  it('drains complete events and keeps incomplete lines as pending buffer', () => {
    const deltas: string[] = []
    const drained = drainSseBuffer('data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choi', false, (delta) => deltas.push(delta))
    expect(deltas).toEqual(['你'])
    expect(drained.pending).toBe('data: {"choi')
    expect(drained.done).toBe(false)
  })

  it('skips heartbeat comments and stops at [DONE]', () => {
    const deltas: string[] = []
    drainSseBuffer(': keep-alive\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"不该出现"}}]}\n', false, (delta) => deltas.push(delta))
    expect(deltas).toEqual([])
  })

  it('ignores malformed events and continues with later ones', () => {
    const deltas: string[] = []
    drainSseBuffer('data: {broken\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n', false, (delta) => deltas.push(delta))
    expect(deltas).toEqual(['好'])
  })

  it('reassembles events split across chunks and returns the full content', async () => {
    const deltas: string[] = []
    const content = await readSseStream(sseStream([
      'data: {"choices":[{"delta":{"content":"思维',
      '导图"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"很',
      '棒"}}]}\n\ndata: [DONE]\n\n',
    ]), (delta) => deltas.push(delta))
    expect(deltas).toEqual(['思维导图', '很棒'])
    expect(content).toBe('思维导图很棒')
  })
})
