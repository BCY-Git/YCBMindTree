/**
 * ai-stream — OpenAI 兼容 SSE 流式读取。
 *
 * chat 对话走流式输出（主流 AI 助手的打字机体验）；结构化生成（分支/计划/沉淀）
 * 需要完整 JSON 才能校验，不走这里。
 *
 * 代理解析容错：跳过心跳注释与空行，遇到 [DONE] 结束；
 * 单个 chunk 可能包含多行事件，一行也可能被拆到多个 chunk，由内部缓冲拼齐。
 */

type StreamChunk = { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> }

/** 从一段 SSE 文本里取出可用的增量内容；返回剩余未拼齐的缓冲与是否收到 [DONE]。 */
export function drainSseBuffer(buffer: string, flush: boolean, onDelta: (delta: string) => void): { pending: string; done: boolean } {
  const lines = buffer.split('\n')
  const pending = flush ? '' : (lines.pop() ?? '')
  let done = false
  for (const rawLine of lines) {
    if (done) break
    const line = rawLine.trimEnd()
    if (!line || line.startsWith(':')) continue
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data) continue
    if (data === '[DONE]') { done = true; continue }
    try {
      const chunk = JSON.parse(data) as StreamChunk
      const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? ''
      if (delta) onDelta(delta)
    } catch {
      // 忽略无法解析的单条事件，继续后续增量。
    }
  }
  return { pending, done }
}

/** 读取响应流并逐段回调增量内容；返回完整文本。 */
export async function readSseStream(body: ReadableStream<Uint8Array>, onDelta: (delta: string) => void): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let done = false
  try {
    while (!done) {
      const { done: finished, value } = await reader.read()
      if (finished) break
      buffer += decoder.decode(value, { stream: true })
      const drained = drainSseBuffer(buffer, false, (delta) => { content += delta; onDelta(delta) })
      buffer = drained.pending
      done = drained.done
    }
    if (done) await reader.cancel().catch(() => undefined)
    buffer += decoder.decode()
    drainSseBuffer(buffer, true, (delta) => { content += delta; onDelta(delta) })
  } finally {
    reader.releaseLock()
  }
  return content
}
