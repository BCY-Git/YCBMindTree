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
import { parseMapReorganization, type MapReorganization } from './map-reorganization'
import { useEditorStore } from '../store/editor.store'
import { platformErrorMessage, requestAiChat } from '../platform/tauri'
import { chatUrl, defaultAiSettings, isGhostCompletionEnabled, loadAiSettings, saveAiSettings, saveGhostCompletionEnabled, type AiSettings } from './ai-settings'
import { buildDepositContext, serializeDepositSource } from './deposit/deposit-context'
import { depositFingerprint, withDuplicateFlags } from './deposit/deposit-dedup'
import { parseDepositAnalysis } from './deposit/deposit-parser'
import { depositSystemPrompt } from './deposit/deposit-prompt'
import { buildDepositPlan, previewDepositOperation } from './deposit/deposit-planner'
import type { DepositBatch, DepositCandidate, DepositPlan, DepositProvenance } from './deposit/deposit-types'
import { applyDepositBatch, applyWorkspaceDepositPlan, listAppliedDepositFingerprints, listDepositBatches, revertWorkspaceDepositBatch, saveDepositBatch } from '../persistence/database'
import { DepositInbox } from '../deposit/DepositInbox'
import { depositNudgeReason } from './deposit/deposit-nudge'
import { WorkflowPanel } from '../workflow/WorkflowPanel'
import { createWorkflowSession, workflowCheckpointPrompt } from './workflow/workflow-service'
import { parseWorkflowCheckpoint } from './workflow/workflow-schema'
import type { WorkflowMode, WorkflowSession } from './workflow/workflow-types'
import { listWorkflowSessions, recordDepositMetric, saveWorkflowSession } from '../persistence/database'
import { parseWorkflowAsset, workflowAssetInstructions, type WorkflowAssetKind } from './workflow/workflow-asset'
import { candidateMetricType, confirmationDuration } from './deposit/deposit-metrics'
import { markDepositTargetRevisited, recordDepositMetricOnce } from '../persistence/database'

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

function trackDepositMetric(event: Parameters<typeof recordDepositMetric>[0], once = false) {
  void (once ? recordDepositMetricOnce(event) : recordDepositMetric(event)).catch(() => undefined)
}

// localStorage 的 key，用于持久化 AI 连接配置（端点、模型、Key）。

// 将导图结构序列化为精简 JSON，供 AI 模型理解当前导图。
// 仅传递结构信息（id、父子关系、主题、折叠态），不包含偏移量等运行时数据。
function mapContext(document: MindMapDocument) {
  return JSON.stringify({
    title: document.title,
    rootId: document.rootId,
    nodes: Object.values(document.nodes).map(({ id, parentId, childIds, topic, collapsed }) => ({ id, parentId, childIds, topic, collapsed })),
  })
}

type GeneratedBranch = { branch: MindNodeClipboard; targetId: string; targetTopic: string; mode: 'branch' | 'plan' | WorkflowAssetKind }
type GeneratedReorganization = { plan: MapReorganization; sourceUpdatedAt: number }

function BranchPreview({ branch, depth = 0 }: { branch: MindNodeClipboard; depth?: number }) {
  const taskMeta = [branch.taskStatus !== 'none' ? (branch.taskStatus === 'done' ? '已完成' : branch.taskStatus === 'doing' ? '进行中' : '待办') : '', branch.priority ? `P${branch.priority}` : '', branch.dueDate ?? ''].filter(Boolean).join(' · ')
  return <ul className={`ai-branch-preview__list depth-${depth}`}><li><span>{branch.topic}</span>{taskMeta && <small>{taskMeta}</small>}{branch.children.map((child, index) => <BranchPreview key={`${child.topic}-${index}`} branch={child} depth={depth + 1} />)}</li></ul>
}

function ReorganizationPreview({ plan, document }: { plan: MapReorganization; document: MindMapDocument }) {
  if (!plan.moves.length) return <div className="ai-reorganization-preview__empty">AI 认为当前层级已经足够清晰，无需调整。</div>
  return <ul className="ai-reorganization-preview__list">{plan.moves.map((move) => {
    const node = document.nodes[move.nodeId]
    const from = node?.parentId ? document.nodes[node.parentId] : null
    const to = document.nodes[move.newParentId]
    return <li key={move.nodeId}><strong>{node?.topic ?? '已删除节点'}</strong><span>{from?.topic ?? '根主题'} → {to?.topic ?? '根主题'}</span></li>
  })}</ul>
}

export function AiAssistant({ document, targetNodeId, workspaceDocuments, onBeforeWorkspaceApply, onWorkspaceDocumentsChanged }: { document: MindMapDocument; targetNodeId: string; workspaceDocuments: MindMapDocument[]; onBeforeWorkspaceApply: () => Promise<void>; onWorkspaceDocumentsChanged: (documents: MindMapDocument[]) => void }) {
  const insertGeneratedBranch = useEditorStore((state) => state.insertGeneratedBranch)
  const dispatch = useEditorStore((state) => state.dispatch)
  const [settings, setSettings] = useState<AiSettings>(defaultAiSettings)
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [notice, setNotice] = useState('配置后即可让 AI 基于当前导图协助思考。')
  const [isSending, setIsSending] = useState(false)
  const [generatedBranch, setGeneratedBranch] = useState<GeneratedBranch | null>(null)
  const [reorganization, setReorganization] = useState<GeneratedReorganization | null>(null)
  const [ghostCompletionEnabled, setGhostCompletionEnabled] = useState(false)
  const [depositBatch, setDepositBatch] = useState<DepositBatch | null>(null)
  const [depositPreview, setDepositPreview] = useState<DepositPlan | null>(null)
  const [depositDebugContext, setDepositDebugContext] = useState<ReturnType<typeof buildDepositContext> | null>(null)
  const [lastWorkspaceDepositBatchId, setLastWorkspaceDepositBatchId] = useState<string | null>(null)
  const [workflowSession, setWorkflowSession] = useState<WorkflowSession | null>(null)
  const [depositNudgeHidden, setDepositNudgeHidden] = useState(false)

  useEffect(() => { setSettings(loadAiSettings()); setGhostCompletionEnabled(isGhostCompletionEnabled()) }, [])
  useEffect(() => {
    let active = true
    void listDepositBatches(document.id).then((batches) => {
      const pending = batches.find((batch) => batch.status === 'pending' && batch.candidates.some((candidate) => candidate.status === 'pending' || candidate.status === 'accepted'))
      if (active) setDepositBatch(pending ?? null)
    }).catch(() => { if (active) setDepositBatch(null) })
    return () => { active = false }
  }, [document.id])
  useEffect(() => { setDepositNudgeHidden(false) }, [document.id, targetNodeId])
  useEffect(() => {
    void markDepositTargetRevisited(document.id, targetNodeId).catch(() => undefined)
  }, [document.id, targetNodeId])
  useEffect(() => {
    let active = true
    void listWorkflowSessions(document.id).then((sessions) => {
      const session = sessions.find((item) => item.status === 'active' && Boolean(document.nodes[item.focusNodeId])) ?? null
      if (active) setWorkflowSession(session)
    }).catch(() => { if (active) setWorkflowSession(null) })
    return () => { active = false }
  }, [document.id])
  useEffect(() => {
    const reflectDepositHistory = (event: Event) => {
      const detail = (event as CustomEvent<{ batchId: string; applied: boolean }>).detail
      setDepositBatch((current) => {
        if (!current || current.id !== detail?.batchId) return current
        return {
          ...current,
          status: detail.applied ? 'applied' : 'pending',
          appliedAt: detail.applied ? Date.now() : null,
          candidates: current.candidates.map((candidate) => {
            if (!detail.applied && candidate.status === 'applied') return { ...candidate, status: 'accepted' }
            if (detail.applied && candidate.status === 'accepted') return { ...candidate, status: 'applied' }
            return candidate
          }),
        }
      })
    }
    window.addEventListener('mindtree:deposit-history', reflectDepositHistory)
    return () => window.removeEventListener('mindtree:deposit-history', reflectDepositHistory)
  }, [])

  // 本地开发时可由 Vite 代理读取项目 .env 中的密钥；生产环境仍需用户自行配置 Key。
  const isConfigured = Boolean(settings.endpoint.trim() && settings.model.trim() && (settings.apiKey.trim() || import.meta.env.DEV))
  const update = (field: keyof AiSettings, value: string) => setSettings((current) => ({ ...current, [field]: value }))
  const saveSettings = () => {
    try {
      saveAiSettings(settings)
      setNotice(isConfigured ? '连接配置已仅保存到当前浏览器。' : '请填写服务地址、模型名和 API Key。')
    } catch {
      setNotice('当前浏览器无法保存配置，请检查本地存储权限。')
    }
  }
  const depositNudgeDisabled = localStorage.getItem(`mindtree.deposit-nudge.disabled.${document.id}`) === 'true'
  const depositNudge = !depositNudgeDisabled && !depositNudgeHidden && !depositBatch ? depositNudgeReason(document, targetNodeId) : null

  const toggleGhostCompletion = (enabled: boolean) => {
    setGhostCompletionEnabled(enabled)
    saveGhostCompletionEnabled(enabled)
  }

  const requestAssistant = async (intent: 'chat' | 'branch' | 'plan' | 'reorganize' | 'deposit' | 'checkpoint' | WorkflowAssetKind) => {
    if (!isConfigured) {
      setSettingsOpen(true)
      setNotice('请先完成并保存连接配置。')
      return
    }
    if (!prompt.trim() && intent === 'chat') return

    setIsSending(true)
    setNotice(intent === 'branch' ? '正在生成可插入的分支…' : intent === 'plan' ? '正在生成可确认的执行计划…' : intent === 'reorganize' ? '正在分析全图结构并生成预览…' : intent === 'deposit' ? '正在分析当前子树中可沉淀的内容…' : intent === 'checkpoint' ? '正在提取阶段检查点…' : intent === 'decision-record' ? '正在生成可确认的决策记录…' : intent === 'knowledge-card' ? '正在生成可确认的知识卡…' : '正在请求你的模型…')
    setResponse('')
    if (intent !== 'chat') setGeneratedBranch(null)
    if (intent !== 'reorganize') setReorganization(null)
    if (intent !== 'deposit') setDepositPreview(null)
    try {
      const isWorkflowAsset = intent === 'decision-record' || intent === 'knowledge-card'
      if (isWorkflowAsset && !workflowSession) throw new Error('请先开始一次智能协作。')
      const target = isWorkflowAsset && workflowSession
        ? document.nodes[workflowSession.focusNodeId] ?? document.nodes[targetNodeId] ?? document.nodes[document.rootId]
        : document.nodes[targetNodeId] ?? document.nodes[document.rootId]
      const appliedFingerprints = intent === 'deposit' ? await listAppliedDepositFingerprints(document.id) : []
      const depositContext = intent === 'deposit' ? buildDepositContext(document, target.id, appliedFingerprints, workspaceDocuments) : null
      if (depositContext) setDepositDebugContext(depositContext)
      const instruction = isWorkflowAsset
        ? workflowAssetInstructions[intent]
        : intent === 'branch'
        ? '你是 MindTree 的思维导图助手。根据用户要求扩展当前节点。只返回合法 JSON，不要 Markdown 或解释。格式必须为：{"topic":"分支主题","children":[{"topic":"子主题","children":[]}]}; 最多 6 层、60 个节点。'
        : intent === 'plan'
          ? '你是 MindTree 的执行计划助手。根据用户要求把当前节点拆成可执行任务。只返回合法 JSON，不要 Markdown 或解释。格式必须为：{"topic":"计划名称","children":[{"topic":"任务","taskStatus":"todo","priority":1,"dueDate":"YYYY-MM-DD","children":[]}]}; 任务最多 12 项。priority 只能为 1、2、3；没有明确日期时省略 dueDate。'
          : intent === 'reorganize'
            ? '你是 MindTree 的导图结构编辑助手。审查整张导图的层级是否有重复、错位或归属不清的节点。只返回合法 JSON，不要 Markdown 或解释。格式必须为：{"summary":"一句整理说明","moves":[{"nodeId":"现有节点ID","newParentId":"现有父节点ID","index":0}]}. 只能使用输入中已有的 ID；不要移动根节点、自由主题；没有必要调整时返回空 moves 数组；最多 24 项。'
            : intent === 'deposit'
              ? depositSystemPrompt
              : intent === 'checkpoint'
                ? workflowCheckpointPrompt
        : '你是 MindTree 的思维导图助手。请用简洁中文协助用户梳理、扩展或优化导图。'
      const requestPrompt = prompt.trim() || (intent === 'reorganize'
        ? '请分析整张导图的层级与归属，仅提出确有必要的结构调整。'
        : intent === 'deposit'
          ? `请分析当前子树「${target.topic}」中真正值得回流、推进或长期保留的信息。`
          : intent === 'checkpoint'
            ? `请围绕「${target.topic}」生成当前阶段检查点。`
            : intent === 'decision-record'
              ? `请根据协作状态与「${target.topic}」的现有内容生成决策记录草稿。`
              : intent === 'knowledge-card'
                ? `请根据协作状态与「${target.topic}」的现有内容生成知识卡草稿。`
        : `请围绕「${target.topic}」补全最有价值的分支。`)
      const workflowContext = workflowSession ? `\n\n当前协作状态：${JSON.stringify(workflowSession)}` : ''
      const result = await requestAiChat(chatUrl(settings.endpoint), {
            model: settings.model.trim(),
            messages: [
              { role: 'system', content: `${instruction}\n当前导图数据如下：` },
              { role: 'user', content: intent === 'deposit'
                ? `${requestPrompt}\n\n分析上下文：${JSON.stringify(depositContext)}${workflowContext}`
                : `${requestPrompt}\n\n当前插入目标：${target.topic}（${target.id}）\n\n当前导图：${mapContext(document)}${workflowContext}` },
            ],
            temperature: 0.7,
          }, settings.apiKey)
      const payload = await result.json().catch(() => ({})) as ChatResponse
      if (!result.ok) throw new Error(payload.error?.message || `请求失败（${result.status}）`)
      const content = payload.choices?.[0]?.message?.content?.trim()
      if (!content) throw new Error('模型没有返回可显示的内容。')
      if (intent === 'checkpoint') {
        if (!workflowSession) throw new Error('请先开始一次智能协作。')
        const proposal = parseWorkflowCheckpoint(content)
        const sourceContext = buildDepositContext(document, target.id, [], [document])
        const checkpoint = { ...proposal, id: crypto.randomUUID(), sourceNodeIds: sourceContext.source.nodes.map((node) => node.id), createdAt: Date.now() }
        const unique = (values: string[]) => [...new Set(values)]
        const next: WorkflowSession = { ...workflowSession, confirmedFacts: unique([...workflowSession.confirmedFacts, ...proposal.confirmed]), rejectedOptions: unique([...workflowSession.rejectedOptions, ...proposal.rejected]), constraints: unique([...workflowSession.constraints, ...proposal.constraints]), openQuestions: proposal.openQuestions, nextActions: proposal.nextActions, checkpoints: [...workflowSession.checkpoints, checkpoint].slice(-100), updatedAt: Date.now() }
        await saveWorkflowSession(next)
        setWorkflowSession(next)
        setNotice('阶段检查点已保存到协作会话；需要长期保留的内容可继续生成沉淀建议。')
      } else if (intent === 'deposit') {
        if (!depositContext) throw new Error('无法构建沉淀分析范围。')
        const proposal = parseDepositAnalysis(content, {
          sourceNodeIds: depositContext.source.nodes.map((node) => node.id),
          destinationNodeIdsByDocument: Object.fromEntries(depositContext.destinations.map((destination) => [destination.documentId, destination.candidateNodes.map((node) => node.id)])),
        })
        const now = Date.now()
        const batchId = crypto.randomUUID()
        const candidates: DepositCandidate[] = proposal.candidates.map((candidate) => ({
          ...candidate,
          id: crypto.randomUUID(),
          batchId,
          duplicateOfCandidateId: null,
          status: 'pending',
          fingerprint: depositFingerprint(document.id, candidate.sourceNodeIds, candidate.title, candidate.type),
        }))
        const batch: DepositBatch = {
          id: batchId,
          sourceDocumentId: document.id,
          sourceNodeIds: depositContext.source.selectedNodeIds,
          scope: 'subtree',
          sourceDocumentUpdatedAt: document.updatedAt,
          sourceSnapshot: serializeDepositSource(depositContext),
          status: 'pending',
          summary: proposal.summary,
          candidates: withDuplicateFlags(candidates, new Set(appliedFingerprints)),
          createdAt: now,
          updatedAt: now,
          appliedAt: null,
        }
        await saveDepositBatch(batch)
        trackDepositMetric({ documentId: document.id, batchId: batch.id, type: 'generated', value: batch.candidates.length })
        const duplicateCount = batch.candidates.filter((candidate) => candidate.duplicateOfCandidateId).length
        if (duplicateCount) trackDepositMetric({ documentId: document.id, batchId: batch.id, type: 'duplicate', value: duplicateCount })
        setDepositBatch(batch)
        const rangeNotice = depositContext.source.truncated ? `实际分析前 ${depositContext.source.nodes.length}/${depositContext.source.totalNodeCount} 个节点。` : ''
        setNotice(batch.candidates.length ? `已识别 ${batch.candidates.length} 条候选，请确认后再写入。${rangeNotice}` : `未发现需要沉淀的高价值内容。${rangeNotice}`)
      } else if (intent === 'reorganize') {
        const plan = parseMapReorganization(content, document)
        setReorganization({ plan, sourceUpdatedAt: document.updatedAt })
        setNotice(plan.moves.length ? `已生成 ${plan.moves.length} 项全图整理建议，请先核对预览。` : 'AI 认为当前结构无需调整。')
      } else if (intent !== 'chat') {
        const branch = isWorkflowAsset ? parseWorkflowAsset(content, intent) : parseGeneratedBranch(content)
        setGeneratedBranch({ branch, targetId: target.id, targetTopic: target.topic, mode: intent })
        setNotice(intent === 'plan' ? `已生成 ${branchNodeCount(branch)} 个待插入计划节点，请先确认预览。` : isWorkflowAsset ? `已生成「${branch.topic}」草稿，请确认后写入协作焦点。` : `已生成 ${branchNodeCount(branch)} 个待插入节点，请先确认预览。`)
      } else {
        setResponse(content)
        setNotice('已收到模型回复。')
      }
    } catch (error) {
      setNotice(platformErrorMessage(error, '连接失败，请检查服务地址、模型名、Key 或跨域设置。'))
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

  const confirmReorganization = () => {
    if (!reorganization?.plan.moves.length) return
    if (document.updatedAt !== reorganization.sourceUpdatedAt) {
      setReorganization(null)
      setNotice('导图在预览期间已变更，请重新生成整理建议。')
      return
    }
    const applied = dispatch({ type: 'REORGANIZE_NODES', moves: reorganization.plan.moves })
    setNotice(applied ? `已应用 ${reorganization.plan.moves.length} 项结构调整，可按 ⌘Z 撤销。` : '应用失败：导图在预览期间已发生变化，请重新生成。')
    if (applied) setReorganization(null)
  }

  const updateDepositCandidate = (candidateId: string, patch: Partial<DepositCandidate>) => {
    if (depositBatch) {
      const metricType = candidateMetricType(patch)
      if (metricType) trackDepositMetric({ documentId: document.id, batchId: depositBatch.id, referenceId: candidateId, type: metricType, value: 1 }, true)
    }
    setDepositPreview(null)
    setDepositBatch((current) => {
      if (!current) return current
      const next = { ...current, updatedAt: Date.now(), candidates: current.candidates.map((candidate) => candidate.id === candidateId ? { ...candidate, ...patch } : candidate) }
      void saveDepositBatch(next)
      return next
    })
  }

  const updateWorkflowSession = (patch: Partial<WorkflowSession>) => {
    setWorkflowSession((current) => {
      if (!current) return current
      const next = { ...current, ...patch, updatedAt: Date.now() }
      void saveWorkflowSession(next)
      return next
    })
  }

  const startWorkflow = (mode: WorkflowMode) => {
    const target = document.nodes[targetNodeId] ?? document.nodes[document.rootId]
    const session = createWorkflowSession(document.id, target.id, prompt.trim() || target.topic, mode)
    setWorkflowSession(session)
    void saveWorkflowSession(session)
    setNotice(`已围绕「${target.topic}」开始${mode === 'explore' ? '探索' : mode === 'decide' ? '决策' : '交付'}协作。`)
  }

  const completeWorkflow = () => {
    if (!workflowSession) return
    const completed: WorkflowSession = { ...workflowSession, phase: 'completed', status: 'completed', updatedAt: Date.now(), completedAt: Date.now() }
    void saveWorkflowSession(completed)
    setWorkflowSession(null)
    setNotice('本次智能协作已完成并保留检查点。')
  }

  const updateDepositCandidates = (candidateIds: string[], status: 'pending' | 'accepted') => {
    const selected = new Set(candidateIds)
    if (depositBatch && status === 'accepted') candidateIds.forEach((candidateId) => trackDepositMetric({ documentId: document.id, batchId: depositBatch.id, referenceId: candidateId, type: 'accepted', value: 1 }, true))
    setDepositPreview(null)
    setDepositBatch((current) => {
      if (!current) return current
      const next = { ...current, updatedAt: Date.now(), candidates: current.candidates.map((candidate) => selected.has(candidate.id) ? { ...candidate, status } : candidate) }
      void saveDepositBatch(next)
      return next
    })
  }

  const previewDeposit = () => {
    if (!depositBatch) return
    try {
      const plan = buildDepositPlan(workspaceDocuments, depositBatch)
      setDepositPreview(plan)
      setNotice(plan.operations.length ? `请核对 ${plan.operations.length} 项写入变化。` : '所选内容仅保留在原记录中，不会修改导图。')
    } catch (error) {
      setNotice(platformErrorMessage(error, '无法生成沉淀预览。'))
    }
  }

  const confirmDeposit = async () => {
    if (!depositBatch || !depositPreview) return
    if (document.updatedAt !== depositPreview.expectedDocumentUpdatedAt[document.id]) {
      setDepositPreview(null)
      setNotice('导图在预览期间已变化，请重新分析。')
      return
    }
    const accepted = depositBatch.candidates.filter((candidate) => depositPreview.includedCandidateIds.includes(candidate.id))
    const crossDocument = depositPreview.operations.some((item) => item.documentId !== document.id)
    if (crossDocument) {
      try {
        await onBeforeWorkspaceApply()
        const result = await applyWorkspaceDepositPlan(depositPreview, depositBatch, settings.model.trim())
        onWorkspaceDocumentsChanged(result.documents)
        setDepositBatch(result.batch)
        setDepositPreview(null)
        setLastWorkspaceDepositBatchId(depositBatch.id)
        setNotice(`已跨导图沉淀 ${accepted.length} 条内容，所有目标已在同一事务中写入。`)
        trackDepositMetric({ documentId: document.id, batchId: depositBatch.id, referenceId: 'application', type: 'applied', value: accepted.length }, true)
        trackDepositMetric({ documentId: document.id, batchId: depositBatch.id, referenceId: 'confirmation', type: 'confirmation-duration', value: confirmationDuration(depositBatch) }, true)
      } catch (error) {
        setNotice(platformErrorMessage(error, '跨导图写入失败，没有产生部分修改。'))
        trackDepositMetric({ documentId: document.id, batchId: depositBatch.id, type: 'failed', value: 1 })
      }
      return
    }
    const localOperations = depositPreview.operations.map((item) => item.operation)
    const applied = !localOperations.length || dispatch({ type: 'APPLY_DEPOSIT_OPERATIONS', batchId: depositBatch.id, operations: localOperations })
    if (!applied) {
      setNotice('写入失败：目标节点可能已经变化，请重新分析。')
      return
    }
    const after = useEditorStore.getState().document
    const provenance: DepositProvenance[] = accepted.map((candidate) => {
      const planned = depositPreview.operations.find((item) => item.candidateId === candidate.id)
      const createdId = candidate.action === 'create' && candidate.suggestedParentId
        ? after.nodes[candidate.suggestedParentId]?.childIds.find((id) => !document.nodes[id] && after.nodes[id]?.topic === candidate.title) ?? null
        : null
      const targetId = createdId ?? candidate.suggestedTargetNodeId
      return { id: crypto.randomUUID(), batchId: depositBatch.id, candidateId: candidate.id, sourceDocumentId: depositBatch.sourceDocumentId, sourceNodeIds: candidate.sourceNodeIds, sourceSnapshot: depositBatch.sourceSnapshot, targetDocumentId: planned?.documentId ?? (targetId ? after.id : null), targetNodeIds: targetId ? [targetId] : [], action: candidate.action, model: settings.model.trim(), acceptedByUser: true, createdAt: Date.now() }
    })
    try {
      const completed = await applyDepositBatch(depositBatch, provenance)
      setDepositBatch(completed)
      setDepositPreview(null)
      setNotice(`已沉淀 ${accepted.length} 条内容${depositPreview.operations.length ? '，可按 ⌘Z 撤销导图写入。' : '。'}`)
      trackDepositMetric({ documentId: document.id, batchId: depositBatch.id, referenceId: 'application', type: 'applied', value: accepted.length }, true)
      trackDepositMetric({ documentId: document.id, batchId: depositBatch.id, referenceId: 'confirmation', type: 'confirmation-duration', value: confirmationDuration(depositBatch) }, true)
    } catch (error) {
      setNotice(platformErrorMessage(error, '导图已更新，但来源记录保存失败，请重试。'))
      trackDepositMetric({ documentId: document.id, batchId: depositBatch.id, type: 'failed', value: 1 })
    }
  }

  const undoWorkspaceDeposit = async () => {
    if (!lastWorkspaceDepositBatchId) return
    try {
      const result = await revertWorkspaceDepositBatch(lastWorkspaceDepositBatchId)
      onWorkspaceDocumentsChanged(result.documents)
      setDepositBatch(result.batch)
      setLastWorkspaceDepositBatchId(null)
      setNotice('已整体撤销本次跨导图沉淀；候选已恢复为待确认状态。')
    } catch (error) {
      setNotice(platformErrorMessage(error, '无法安全撤销：相关导图可能已继续修改。'))
    }
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
          <label className="ai-ghost-toggle"><input type="checkbox" checked={ghostCompletionEnabled} onChange={(event) => toggleGhostCompletion(event.target.checked)} />启用备注幽灵续写（DeepSeek Beta）</label>
          <p className="ai-assistant__privacy">兼容 OpenAI Chat Completions；本地开发会优先使用项目 .env 中的 Key，普通对话与启用后的幽灵续写都会经本机代理转发。</p>
        </div>
      )}

      <WorkflowPanel session={workflowSession} suggestedGoal={prompt.trim()} busy={isSending} onStart={startWorkflow} onChange={updateWorkflowSession} onCheckpoint={() => { void requestAssistant('checkpoint') }} onDeposit={() => { void requestAssistant('deposit') }} onGenerateAsset={(kind) => { void requestAssistant(kind) }} onComplete={completeWorkflow} />
      {depositNudge && <div className="deposit-nudge"><p>{depositNudge}</p><div><button type="button" onClick={() => { void requestAssistant('deposit') }}>现在分析</button><button type="button" onClick={() => setDepositNudgeHidden(true)}>稍后</button><button type="button" onClick={() => { localStorage.setItem(`mindtree.deposit-nudge.disabled.${document.id}`, 'true'); setDepositNudgeHidden(true) }}>不再提示</button></div></div>}

      <form className="ai-prompt" onSubmit={sendPrompt}>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder="例如：帮我找出这张导图缺少的分支" />
        <div className="ai-prompt__actions"><button type="submit" disabled={isSending}>{isSending ? '思考中…' : '询问 AI'}</button><button type="button" className="ai-generate-button" disabled={isSending} onClick={() => { void requestAssistant('branch') }}>生成分支</button><button type="button" className="ai-generate-button ai-generate-button--plan" disabled={isSending} onClick={() => { void requestAssistant('plan') }}>生成计划</button><button type="button" className="ai-generate-button ai-generate-button--reorganize" disabled={isSending} onClick={() => { void requestAssistant('reorganize') }}>整理全图</button><button type="button" className="ai-generate-button ai-generate-button--deposit" disabled={isSending} onClick={() => { void requestAssistant('deposit') }}>生成沉淀建议</button></div>
      </form>
      {generatedBranch && <div className="ai-branch-preview"><div className="ai-branch-preview__heading"><strong>{generatedBranch.mode === 'plan' ? '待插入执行计划' : generatedBranch.mode === 'decision-record' ? '待写入决策记录' : generatedBranch.mode === 'knowledge-card' ? '待写入知识卡' : '待插入分支'} · 「{generatedBranch.targetTopic}」</strong><span>{branchNodeCount(generatedBranch.branch)} 节点</span></div><BranchPreview branch={generatedBranch.branch} /><div className="ai-branch-preview__actions"><button type="button" onClick={confirmGeneratedBranch}>确认插入</button><button type="button" onClick={() => { setGeneratedBranch(null); setNotice('已放弃本次生成。') }}>放弃</button></div></div>}
      {reorganization && <div className="ai-reorganization-preview"><div className="ai-branch-preview__heading"><strong>待应用全图整理</strong><span>{reorganization.plan.moves.length} 项调整</span></div><p>{reorganization.plan.summary}</p><ReorganizationPreview plan={reorganization.plan} document={document} /><div className="ai-branch-preview__actions"><button type="button" disabled={!reorganization.plan.moves.length} onClick={confirmReorganization}>确认应用</button><button type="button" onClick={() => { setReorganization(null); setNotice('已放弃本次全图整理建议。') }}>放弃</button></div></div>}
      {import.meta.env.DEV && depositDebugContext && <details className="deposit-debug"><summary>查看本次发送范围</summary><pre>{JSON.stringify(depositDebugContext, null, 2)}</pre></details>}
      {depositBatch?.status === 'pending' && <DepositInbox batch={depositBatch} document={document} workspaceDocuments={workspaceDocuments} onChange={updateDepositCandidate} onChangeAll={updateDepositCandidates} onPreview={previewDeposit} onDismiss={() => { setDepositBatch(null); setDepositPreview(null); setNotice('已保留本批候选，可稍后继续处理。') }} />}
      {depositPreview && <div className="ai-deposit-preview"><div className="ai-branch-preview__heading"><strong>待写入沉淀</strong><span>{depositPreview.operations.length} 项变化</span></div><ul>{depositPreview.operations.map((item, index) => { const targetDocument = workspaceDocuments.find((candidate) => candidate.id === item.documentId); return <li key={`${item.operation.type}-${index}`}>{targetDocument?.title ?? '未知导图'} · {targetDocument ? previewDepositOperation(targetDocument, item.operation) : '目标已删除'}</li> })}</ul><div className="ai-branch-preview__actions"><button type="button" onClick={() => { void confirmDeposit() }}>确认写入</button><button type="button" onClick={() => setDepositPreview(null)}>返回修改</button></div></div>}
      {lastWorkspaceDepositBatchId && <button type="button" className="deposit-workspace-undo" onClick={() => { void undoWorkspaceDeposit() }}>撤销上一次跨导图沉淀</button>}
      {response && <div className="ai-response" aria-live="polite">{response}</div>}
    </section>
  )
}
