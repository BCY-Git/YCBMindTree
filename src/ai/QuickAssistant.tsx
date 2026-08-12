import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { MindMapDocument } from '../domain/document.types'
import { chatUrl, loadAiSettings } from './ai-settings'
import { platformErrorMessage, requestAiChat } from '../platform/tauri'
import { retrieveWorkspaceContext } from './workspace-retrieval'
import { recordAiRetrievalUsage } from '../search/search-usage-metrics'
import { randomUuid } from '../platform/random-uuid'

type QuickMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: number }
type ChatResponse = { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }

const storageKey = 'mindtree.quick-assistant.v1'

function AssistantRobotIcon({ compact = false }: { compact?: boolean }) {
  return <svg className={`assistant-robot-icon${compact ? ' is-compact' : ''}`} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path className="assistant-robot-icon__antenna" d="M16 8V5.2M16 5.2 12.5 2.8M16 5.2l3.5-2.4" />
    <circle className="assistant-robot-icon__node assistant-robot-icon__node--left" cx="12.2" cy="2.6" r="1.35" />
    <circle className="assistant-robot-icon__node assistant-robot-icon__node--right" cx="19.8" cy="2.6" r="1.35" />
    <path className="assistant-robot-icon__head" d="M5.5 16.3c0-5.6 4.15-8.8 10.5-8.8s10.5 3.2 10.5 8.8v3.15c0 5.42-4.05 8.55-10.5 8.55S5.5 24.87 5.5 19.45V16.3Z" />
    <path className="assistant-robot-icon__visor" d="M9.15 15.8c0-2.45 1.72-3.8 6.85-3.8s6.85 1.35 6.85 3.8v1.05c0 2.45-1.72 3.8-6.85 3.8s-6.85-1.35-6.85-3.8V15.8Z" />
    <circle className="assistant-robot-icon__eye assistant-robot-icon__eye--left" cx="13.25" cy="16.35" r="1.25" />
    <circle className="assistant-robot-icon__eye assistant-robot-icon__eye--right" cx="18.75" cy="16.35" r="1.25" />
    <path className="assistant-robot-icon__smile" d="M13.1 23.35c.78.55 1.75.82 2.9.82s2.12-.27 2.9-.82" />
  </svg>
}

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

/** 与 AiAssistant 的配置判定保持一致：开发环境可由 Vite 代理读取 .env 密钥。 */
function hasModelConfig() {
  const settings = loadAiSettings()
  return Boolean(settings.endpoint.trim() && settings.model.trim() && (settings.apiKey.trim() || import.meta.env.DEV))
}

export function QuickAssistant({ document, workspaceDocuments, onOpenSettings }: { document: MindMapDocument; workspaceDocuments: MindMapDocument[]; onOpenSettings?: () => void }) {
  const [open, setOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memory, setMemory] = useState('')
  const [messages, setMessages] = useState<QuickMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [notice, setNotice] = useState('可以问我一个想法、待办或当前导图的问题。')
  const [sending, setSending] = useState(false)
  // 移动端很难发现右侧 Dock 的配置入口；未配置时在面板内给出显式跳转按钮。
  const [needsSettings, setNeedsSettings] = useState(false)

  useEffect(() => {
    const session = loadSession()
    setMemory(session.memory)
    setMessages(session.messages)
    setNeedsSettings(!hasModelConfig())
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
      setNeedsSettings(true)
      setNotice('请先完成模型连接配置。')
      return
    }
    const question: QuickMessage = { id: randomUuid(), role: 'user', content, createdAt: Date.now() }
    const history = [...messages, question].slice(-12)
    setMessages(history)
    setPrompt('')
    setSending(true)
    setNotice('正在思考…')
    try {
      const retrievedWorkspace = retrieveWorkspaceContext({ documents: workspaceDocuments, currentDocumentId: document.id, text: content, focusText: document.title })
      recordAiRetrievalUsage({ resultCount: retrievedWorkspace.length, limit: 12 })
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
      setMessages((current) => [...current, { id: randomUuid(), role: 'assistant' as const, content: answer, createdAt: Date.now() }].slice(-40))
      setNotice('已记录到本机对话历史。')
    } catch (error) {
      setNotice(platformErrorMessage(error, '暂时无法连接助手。'))
    } finally {
      setSending(false)
    }
  }

  return <>
    <button className="quick-assistant-fab" onClick={() => setOpen(true)} aria-label="打开随手助手" title="随手助手">
      <span className="quick-assistant-fab__halo" aria-hidden="true" />
      <AssistantRobotIcon />
    </button>
    {open && <section className="quick-assistant" aria-label="随手助手">
      <header><div><span className="quick-assistant__mark"><AssistantRobotIcon compact /></span><strong>随手助手</strong><small>独立于右侧 AI 工作台</small></div><button onClick={() => setOpen(false)} aria-label="关闭随手助手">×</button></header>
      <p className="quick-assistant__notice">{notice}</p>
      {needsSettings && onOpenSettings && <button className="quick-assistant__settings-link" onClick={() => { onOpenSettings(); setOpen(false) }}>去配置模型连接（端点 / 模型 / Key）</button>}
      <div className="quick-assistant__quick-actions">{quickPrompts.map((item) => <button key={item} disabled={sending} onClick={() => { void ask(undefined, item) }}>{item}</button>)}</div>
      <div className="quick-assistant__history" aria-live="polite">
        {messages.length ? messages.map((message, index) => <article key={message.id} className={`quick-assistant__message is-${message.role} ${index > 0 && messages[index - 1].role === message.role ? 'is-followup' : ''}`}><span>{message.role === 'user' ? '你' : '助手'}</span><p>{message.content}</p></article>) : <p className="quick-assistant__empty">对话会仅保存在此浏览器。可在下方写入长期记忆，例如你的工作偏好。</p>}
      </div>
      <button className="quick-assistant__memory-toggle" onClick={() => setMemoryOpen((value) => !value)} aria-expanded={memoryOpen}>记忆 {memoryOpen ? '收起' : memory ? '已保存' : '添加'}</button>
      {memoryOpen && <textarea className="quick-assistant__memory" value={memory} onChange={(event) => setMemory(event.target.value)} placeholder="例如：我偏好先给结论，再列出可执行步骤。" rows={3} />}
      <form onSubmit={(event) => { void ask(event) }}><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入一个问题或想法…" rows={2} /><button disabled={sending || !prompt.trim()} type="submit">{sending ? '思考中…' : '发送'}</button></form>
      {messages.length > 0 && <button className="quick-assistant__clear" onClick={() => { setMessages([]); setNotice('本机对话记录已清空。') }}>清空对话记录</button>}
    </section>}
  </>
}
