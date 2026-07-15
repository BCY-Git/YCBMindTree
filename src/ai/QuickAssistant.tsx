import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { MindMapDocument } from '../domain/document.types'
import { chatUrl, loadAiSettings } from './ai-settings'
import { platformErrorMessage, requestAiChat } from '../platform/tauri'
import { retrieveWorkspaceContext } from './workspace-retrieval'

type QuickMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: number }
type ChatResponse = { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }

const storageKey = 'mindtree.quick-assistant.v1'

function loadSession(): { memory: string; messages: QuickMessage[] } {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<{ memory: string; messages: QuickMessage[] }>
    return { memory: value.memory ?? '', messages: Array.isArray(value.messages) ? value.messages.slice(-40) : [] }
  } catch {
    return { memory: '', messages: [] }
  }
}

function mapSnapshot(document: MindMapDocument) {
  return JSON.stringify({
    title: document.title,
    nodes: Object.values(document.nodes).map(({ id, parentId, topic, note, taskStatus }) => ({ id, parentId, topic, note, taskStatus })),
  })
}

export function QuickAssistant({ document, workspaceDocuments }: { document: MindMapDocument; workspaceDocuments: MindMapDocument[] }) {
  const [open, setOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memory, setMemory] = useState('')
  const [messages, setMessages] = useState<QuickMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [notice, setNotice] = useState('可以问我一个想法、待办或当前导图的问题。')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const session = loadSession()
    setMemory(session.memory)
    setMessages(session.messages)
  }, [])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ memory, messages: messages.slice(-40) }))
  }, [memory, messages])

  const quickPrompts = useMemo(() => [
    '帮我提炼当前最值得做的下一步。',
    '找出当前导图缺失的关键分支。',
    '把当前内容整理成待办清单。',
  ], [])

  const ask = async (event?: FormEvent, preset?: string) => {
    event?.preventDefault()
    const content = (preset ?? prompt).trim()
    if (!content || sending) return
    const settings = loadAiSettings()
    if (!settings.endpoint.trim() || !settings.model.trim() || (!settings.apiKey.trim() && !import.meta.env.DEV)) {
      setNotice('请先在左侧 AI 助手中完成模型连接配置。')
      return
    }
    const question: QuickMessage = { id: crypto.randomUUID(), role: 'user', content, createdAt: Date.now() }
    const history = [...messages, question].slice(-12)
    setMessages(history)
    setPrompt('')
    setSending(true)
    setNotice('正在思考…')
    try {
      const retrievedWorkspace = retrieveWorkspaceContext({ documents: workspaceDocuments, currentDocumentId: document.id, text: content, focusText: document.title })
      const result = await requestAiChat(chatUrl(settings.endpoint), {
            model: settings.model.trim(),
            temperature: 0.55,
            messages: [
              { role: 'system', content: `你是 MindTree 的轻量随手助手。用简洁中文帮助用户拆解想法、提出下一步或澄清问题。用户记忆：${memory || '无'}。当前导图：${mapSnapshot(document)}。相关工作区节点（仅供参考）：${JSON.stringify(retrievedWorkspace)}` },
              ...history.map((message) => ({ role: message.role, content: message.content })),
            ],
          }, settings.apiKey)
      const payload = await result.json().catch(() => ({})) as ChatResponse
      if (!result.ok) throw new Error(payload.error?.message || `请求失败（${result.status}）`)
      const answer = payload.choices?.[0]?.message?.content?.trim()
      if (!answer) throw new Error('模型没有返回内容。')
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant' as const, content: answer, createdAt: Date.now() }].slice(-40))
      setNotice('已记录到本机对话历史。')
    } catch (error) {
      setNotice(platformErrorMessage(error, '暂时无法连接助手。'))
    } finally {
      setSending(false)
    }
  }

  return <>
    <button className="quick-assistant-fab" onClick={() => setOpen(true)} aria-label="打开随手助手" title="随手助手">
      <span className="quick-assistant-fab__orb"><i /><i /><i /></span>
      <span className="quick-assistant-fab__spark">✦</span>
    </button>
    {open && <section className="quick-assistant" aria-label="随手助手">
      <header><div><span className="quick-assistant__mark">✦</span><strong>随手助手</strong><small>独立于左侧 AI 助手</small></div><button onClick={() => setOpen(false)} aria-label="关闭随手助手">×</button></header>
      <p className="quick-assistant__notice">{notice}</p>
      <div className="quick-assistant__quick-actions">{quickPrompts.map((item) => <button key={item} disabled={sending} onClick={() => { void ask(undefined, item) }}>{item}</button>)}</div>
      <div className="quick-assistant__history" aria-live="polite">
        {messages.length ? messages.map((message) => <article key={message.id} className={`quick-assistant__message is-${message.role}`}><span>{message.role === 'user' ? '你' : '助手'}</span><p>{message.content}</p></article>) : <p className="quick-assistant__empty">对话会仅保存在此浏览器。可在下方写入长期记忆，例如你的工作偏好。</p>}
      </div>
      <button className="quick-assistant__memory-toggle" onClick={() => setMemoryOpen((value) => !value)} aria-expanded={memoryOpen}>记忆 {memoryOpen ? '收起' : memory ? '已保存' : '添加'}</button>
      {memoryOpen && <textarea className="quick-assistant__memory" value={memory} onChange={(event) => setMemory(event.target.value)} placeholder="例如：我偏好先给结论，再列出可执行步骤。" rows={3} />}
      <form onSubmit={(event) => { void ask(event) }}><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入一个问题或想法…" rows={2} /><button disabled={sending || !prompt.trim()} type="submit">{sending ? '思考中…' : '发送'}</button></form>
      {messages.length > 0 && <button className="quick-assistant__clear" onClick={() => { setMessages([]); setNotice('本机对话记录已清空。') }}>清空对话记录</button>}
    </section>}
  </>
}
