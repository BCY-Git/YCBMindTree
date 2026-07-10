/**
 * AI 助手侧边栏面板。
 *
 * 支持配置自定义 OpenAI-compatible API 端点、模型名称和 API Key，
 * 将当前导图的结构化 JSON 作为上下文发给 AI 模型，
 * 并在面板中展示模型回复。
 *
 * 技术细节：
 * - 开发环境下，请求经 Vite 开发服务器代理（/api/ai/chat → 上游真实服务），
 *   避免 CORS 问题；生产环境需配置反向代理
 * - API Key 只保存在浏览器 localStorage，不上传到任何第三方
 * - 发送请求时将导图节点列表（id、父子关系、topic、collapsed）作为上下文，
 *   让 AI 理解当前思维导图结构
 */
import { useEffect, useState, type FormEvent } from 'react'
import type { MindNodeClipboard } from '../domain/commands'
import type { MindMapDocument } from '../domain/document.types'
import { branchNodeCount, parseGeneratedBranch } from './generated-branch'
import { useEditorStore } from '../store/editor.store'

type AiSettings = {
  endpoint: string
  model: string
  apiKey: string
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

// localStorage 的 key，用于持久化 AI 连接配置（端点、模型、Key）。
const storageKey = 'mindtree.ai-settings.v1'
const emptySettings: AiSettings = { endpoint: '', model: '', apiKey: '' }

// 从 localStorage 加载配置，做类型守卫防止脏数据导致页面崩溃。
function loadSettings(): AiSettings {
  try {
    const value = localStorage.getItem(storageKey)
    if (!value) return emptySettings
    const parsed = JSON.parse(value) as Partial<AiSettings>
    return {
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    }
  } catch {
    return emptySettings
  }
}

// 规范 API 路径：用户只需填根地址，自动补全 /chat/completions 后缀。
function chatUrl(endpoint: string) {
  const base = endpoint.trim().replace(/\/$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

// 将导图结构序列化为精简 JSON，供 AI 模型理解当前导图。
// 仅传递结构信息（id、父子关系、主题、折叠态），不包含偏移量等运行时数据。
function mapContext(document: MindMapDocument) {
  return JSON.stringify({
    title: document.title,
    rootId: document.rootId,
    nodes: Object.values(document.nodes).map(({ id, parentId, childIds, topic, collapsed }) => ({ id, parentId, childIds, topic, collapsed })),
  })
}

type GeneratedBranch = { branch: MindNodeClipboard; targetId: string; targetTopic: string }

function BranchPreview({ branch, depth = 0 }: { branch: MindNodeClipboard; depth?: number }) {
  return <ul className={`ai-branch-preview__list depth-${depth}`}><li><span>{branch.topic}</span>{branch.children.map((child, index) => <BranchPreview key={`${child.topic}-${index}`} branch={child} depth={depth + 1} />)}</li></ul>
}

export function AiAssistant({ document, targetNodeId }: { document: MindMapDocument; targetNodeId: string }) {
  const insertGeneratedBranch = useEditorStore((state) => state.insertGeneratedBranch)
  const [settings, setSettings] = useState<AiSettings>(emptySettings)
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [notice, setNotice] = useState('配置后即可让 AI 基于当前导图协助思考。')
  const [isSending, setIsSending] = useState(false)
  const [generatedBranch, setGeneratedBranch] = useState<GeneratedBranch | null>(null)

  useEffect(() => setSettings(loadSettings()), [])

  const isConfigured = Boolean(settings.endpoint.trim() && settings.model.trim() && settings.apiKey.trim())
  const update = (field: keyof AiSettings, value: string) => setSettings((current) => ({ ...current, [field]: value }))
  const saveSettings = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings))
      setNotice(isConfigured ? '连接配置已仅保存到当前浏览器。' : '请填写服务地址、模型名和 API Key。')
    } catch {
      setNotice('当前浏览器无法保存配置，请检查本地存储权限。')
    }
  }

  const requestAssistant = async (intent: 'chat' | 'branch') => {
    if (!isConfigured) {
      setSettingsOpen(true)
      setNotice('请先完成并保存连接配置。')
      return
    }
    if (!prompt.trim() && intent === 'chat') return

    setIsSending(true)
    setNotice(intent === 'branch' ? '正在生成可插入的分支…' : '正在请求你的模型…')
    setResponse('')
    if (intent === 'branch') setGeneratedBranch(null)
    try {
      const target = document.nodes[targetNodeId] ?? document.nodes[document.rootId]
      const instruction = intent === 'branch'
        ? '你是 MindTree 的思维导图助手。根据用户要求扩展当前节点。只返回合法 JSON，不要 Markdown 或解释。格式必须为：{"topic":"分支主题","children":[{"topic":"子主题","children":[]}]}; 最多 6 层、60 个节点。'
        : '你是 MindTree 的思维导图助手。请用简洁中文协助用户梳理、扩展或优化导图。'
      const requestPrompt = prompt.trim() || `请围绕「${target.topic}」补全最有价值的分支。`
      const result = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey.trim()}` },
        body: JSON.stringify({
          endpoint: chatUrl(settings.endpoint),
          request: {
            model: settings.model.trim(),
            messages: [
              { role: 'system', content: `${instruction}\n当前导图数据如下：` },
              { role: 'user', content: `${requestPrompt}\n\n当前插入目标：${target.topic}（${target.id}）\n\n当前导图：${mapContext(document)}` },
            ],
            temperature: 0.7,
          },
        }),
      })
      const payload = await result.json().catch(() => ({})) as ChatResponse
      if (!result.ok) throw new Error(payload.error?.message || `请求失败（${result.status}）`)
      const content = payload.choices?.[0]?.message?.content?.trim()
      if (!content) throw new Error('模型没有返回可显示的内容。')
      if (intent === 'branch') {
        const branch = parseGeneratedBranch(content)
        setGeneratedBranch({ branch, targetId: target.id, targetTopic: target.topic })
        setNotice(`已生成 ${branchNodeCount(branch)} 个待插入节点，请先确认预览。`)
      } else {
        setResponse(content)
        setNotice('已收到模型回复。')
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '连接失败，请检查服务地址、模型名、Key 或跨域设置。')
    } finally {
      setIsSending(false)
    }
  }

  const sendPrompt = (event: FormEvent) => {
    event.preventDefault()
    void requestAssistant('chat')
  }

  const confirmGeneratedBranch = () => {
    if (!generatedBranch) return
    const inserted = insertGeneratedBranch(generatedBranch.targetId, generatedBranch.branch)
    setNotice(inserted ? `已插入「${generatedBranch.branch.topic}」，可按 ⌘Z 撤销。` : '插入失败：目标节点可能已被删除。')
    if (inserted) setGeneratedBranch(null)
  }

  return (
    <section className="ai-assistant" aria-label="AI 助手">
      <div className="ai-assistant__heading">
        <div><span className="ai-assistant__spark">✦</span><span>AI 助手</span></div>
        <button type="button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>{settingsOpen ? '收起' : '配置'}</button>
      </div>
      <p className="ai-assistant__status">{notice}</p>

      {settingsOpen && (
        <div className="ai-settings">
          <label>API 服务地址<input value={settings.endpoint} onChange={(event) => update('endpoint', event.target.value)} placeholder="https://…/v1" /></label>
          <label>模型名称<input value={settings.model} onChange={(event) => update('model', event.target.value)} placeholder="例如 gpt-4o-mini" /></label>
          <label>API Key<input type="password" value={settings.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder="仅保存于此浏览器" autoComplete="off" /></label>
          <button className="ai-save-button" type="button" onClick={saveSettings}>保存连接配置</button>
          <p className="ai-assistant__privacy">兼容 OpenAI Chat Completions；本地开发会先经本机代理转发，只有发送问题时才会请求该服务。</p>
        </div>
      )}

      <form className="ai-prompt" onSubmit={sendPrompt}>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder="例如：帮我找出这张导图缺少的分支" />
        <div className="ai-prompt__actions"><button type="submit" disabled={isSending}>{isSending ? '思考中…' : '询问 AI'}</button><button type="button" className="ai-generate-button" disabled={isSending} onClick={() => { void requestAssistant('branch') }}>生成分支</button></div>
      </form>
      {generatedBranch && <div className="ai-branch-preview"><div className="ai-branch-preview__heading"><strong>待插入到「{generatedBranch.targetTopic}」</strong><span>{branchNodeCount(generatedBranch.branch)} 节点</span></div><BranchPreview branch={generatedBranch.branch} /><div className="ai-branch-preview__actions"><button type="button" onClick={confirmGeneratedBranch}>确认插入</button><button type="button" onClick={() => { setGeneratedBranch(null); setNotice('已放弃本次生成。') }}>放弃</button></div></div>}
      {response && <div className="ai-response" aria-live="polite">{response}</div>}
    </section>
  )
}
