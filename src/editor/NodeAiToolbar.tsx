/**
 * NodeAiToolbar — 选中节点的浮动 AI 工具条（Whimsical ✨ 风格）。
 *
 * - 一键动作：扩展想法（3 个扁平子节点）、扩展分支（2-3 层结构化分支树）
 * - 更多菜单：总结分支、拆解为任务、向 AI 提问、自定义扩展
 * - 生成结果直接写入画布（经 store 命令边界，⌘Z 可撤销），状态提示就地显示
 *
 * 「向 AI 提问」和「自定义…」通过 window 自定义事件分别交给 App 层（打开 AI 工作台）
 * 和画布层（MindMapCanvas 的 AiCustomPrompt 弹层）处理，避免层层透传回调。
 */
import { useEffect, useRef, useState } from 'react'
import { ChatBubbleIcon, DotsHorizontalIcon, MagicWandIcon, StackIcon } from '@radix-ui/react-icons'
import { useEditorStore } from '../store/editor.store'
import { loadAiSettings } from '../ai/ai-settings'
import { requestExpandedIdeas } from '../ai/expand-ideas'
import { branchNodeCount } from '../ai/generated-branch'
import { aiConfigurationError, askAiAboutNode, nodeAiActionMeta, requestNodeAiBranches, type NodeAiAction } from '../ai/node-actions'
import { platformErrorMessage } from '../platform/tauri'

/** 画布层监听该事件弹出「自定义扩展」输入层。 */
export const aiCustomPromptEvent = 'mindtree:node-ai-custom-prompt'

export function requestAiCustomPrompt(nodeId: string) {
  window.dispatchEvent(new CustomEvent(aiCustomPromptEvent, { detail: { nodeId } }))
}

type Status = { tone: 'working' | 'success' | 'error'; text: string }

export function NodeAiToolbar({ nodeId, canAddChild }: { nodeId: string; canAddChild: boolean }) {
  const dispatch = useEditorStore((state) => state.dispatch)
  const insertGeneratedBranch = useEditorStore((state) => state.insertGeneratedBranch)
  const [status, setStatus] = useState<Status | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLSpanElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const statusTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    requestRef.current?.abort()
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as globalThis.Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    globalThis.document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      globalThis.document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const showStatus = (next: Status, autoDismiss = false) => {
    setStatus(next)
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current)
    if (autoDismiss) statusTimerRef.current = window.setTimeout(() => setStatus(null), 2600)
  }

  const working = status?.tone === 'working'

  const run = (action: NodeAiAction, customPrompt?: string) => {
    if (working) return
    setMenuOpen(false)
    const settings = loadAiSettings()
    const configError = aiConfigurationError(settings, import.meta.env.DEV)
    if (configError) { showStatus({ tone: 'error', text: configError }); return }
    const currentDocument = useEditorStore.getState().document
    const controller = new AbortController()
    requestRef.current?.abort()
    requestRef.current = controller
    showStatus({ tone: 'working', text: nodeAiActionMeta[action].working })
    const request = action === 'expand-ideas'
      ? requestExpandedIdeas(settings, currentDocument, nodeId, controller.signal).then((ideas) => {
          const inserted = dispatch({ type: 'ADD_CHILDREN', parentId: nodeId, topics: ideas })
          return inserted ? ideas.length : 0
        })
      : requestNodeAiBranches(settings, currentDocument, nodeId, action, customPrompt, controller.signal).then((branches) => {
          let inserted = 0
          for (const branch of branches) {
            if (insertGeneratedBranch(nodeId, branch)) inserted += branchNodeCount(branch)
          }
          return inserted
        })
    void request
      .then((count) => {
        if (controller.signal.aborted) return
        showStatus(count > 0
          ? { tone: 'success', text: `已生成 ${count} 个节点 · ⌘Z 撤销` }
          : { tone: 'error', text: '节点已变化，请重试' }, true)
      })
      .catch((error) => {
        if (!controller.signal.aborted) showStatus({ tone: 'error', text: platformErrorMessage(error, 'AI 生成失败，请重试') }, true)
      })
      .finally(() => { if (requestRef.current === controller) requestRef.current = null })
  }

  const keepNodeAction = (event: React.SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div className="node-quick-toolbar nodrag nowheel" onPointerDown={keepNodeAction}>
      <button type="button" className="node-quick-toolbar__expand" onClick={() => run('expand-ideas')} disabled={working || !canAddChild} title="让 AI 生成 3 个直接子节点">
        <MagicWandIcon aria-hidden="true" />
        <span>{working ? '生成中…' : nodeAiActionMeta['expand-ideas'].label}</span>
      </button>
      <button type="button" className="node-quick-toolbar__expand" onClick={() => run('expand-branch')} disabled={working || !canAddChild} title="让 AI 生成 2-3 层的结构化分支">
        <StackIcon aria-hidden="true" />
        <span>分支</span>
      </button>
      <span ref={menuRef} className="node-quick-toolbar__more">
        <button type="button" className="node-quick-toolbar__expand" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="更多 AI 操作" title="更多 AI 操作" disabled={working} onClick={() => setMenuOpen((open) => !open)}>
          <DotsHorizontalIcon aria-hidden="true" />
        </button>
        {menuOpen && <span className="node-quick-toolbar__menu" role="menu" aria-label="更多 AI 操作">
          <button type="button" role="menuitem" disabled={!canAddChild} onClick={() => run('summarize')}>📋 {nodeAiActionMeta.summarize.label}</button>
          <button type="button" role="menuitem" disabled={!canAddChild} onClick={() => run('tasks')}>✅ {nodeAiActionMeta.tasks.label}</button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); requestAiCustomPrompt(nodeId) }}>✏️ 自定义扩展…</button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); askAiAboutNode(nodeId) }}><ChatBubbleIcon aria-hidden="true" /> 向 AI 提问…</button>
        </span>}
      </span>
      {status && status.tone !== 'working' && <span className={`node-quick-toolbar__status is-${status.tone}`} role="status">{status.text}</span>}
      {status && status.tone === 'working' && <span className="node-quick-toolbar__status" role="status">{status.text}</span>}
    </div>
  )
}
