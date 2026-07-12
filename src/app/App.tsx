/**
 * App — 应用根组件，组装整体布局和各功能模块。
 *
 * 整体布局为三行：顶部工具栏（topbar）→ 工作区（workspace）→ 状态栏（statusbar）。
 * 工作区为三列：左侧栏（工作区/分类/导图列表 + AI 助手）→ 画布 → 右侧检查器。
 *
 * 生命周期：
 * 1. 挂载时从 IndexedDB 并行加载最新文档和文档列表（hydrate + setDocuments）
 * 2. 每次 document 变化后 450ms 防抖自动保存，并更新文档列表
 *
 * 所有命令通过 dispatch() 派发，状态由 useEditorStore 统一管理。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { MindMapCanvas } from '../editor/MindMapCanvas'
import { getNodeAttachment, getSyncMetadata, listDocumentVersions, listDocuments, loadLatestDocument, saveDocument, saveDocumentVersion, saveNodeAttachment, saveSyncMetadata } from '../persistence/database'
import { useEditorStore } from '../store/editor.store'
import { getTheme, themes } from '../domain/themes'
import { AiAssistant } from '../ai/AiAssistant'
import type { MindMapDocument } from '../domain/document.types'
import { SyncDialog } from '../sync/SyncDialog'
import { createPairingInvite, fetchRemoteDocument, loadSyncConfig, pushDocument, redeemPairingInvite, saveSyncConfig, type PairingInvite, type RemoteDocument, type SyncConfig } from '../sync/sync-client'
import { VersionHistoryDialog } from '../history/VersionHistoryDialog'
import { createDocumentVersion, duplicateDocumentVersion, restoreDocumentVersion, type DocumentVersion } from '../history/version-history'
import { downloadMarkdown, type MarkdownExportMode } from '../export/markdown'
import { GhostNoteEditor } from '../ai/GhostNoteEditor'
import { LoginDialog } from '../auth/LoginDialog'
import { clearAccountSession, loadAccountSession, loginAccount, registerAccount, revokeAccountSession, saveAccountSession, type AuthSession } from '../auth/account-client'
import { TaskCenterDialog } from '../tasks/TaskCenterDialog'
import { collectTasks, type MindTreeTask } from '../tasks/task-index'
import { executeCommand } from '../domain/commands'

// 工具栏图标包装组件（aria-hidden，不暴露给屏幕阅读器）。
function Icon({ children }: { children: ReactNode }) {
  return <span aria-hidden="true" className="toolbar-icon">{children}</span>
}

type Category = { id: string; name: string }
type PendingNavigation =
  | { kind: 'open'; document: MindMapDocument }
  | { kind: 'new-map' }
  | { kind: 'quick-note' }

// localStorage key for persisting user-defined categories.
const categoryStorageKey = 'mindtree.categories.v1'
const defaultCategories: Category[] = [{ id: 'uncategorized', name: '未分类' }]

// Load categories from localStorage, always prepend the default.
function loadCategories(): Category[] {
  try {
    const stored = JSON.parse(localStorage.getItem(categoryStorageKey) ?? '[]') as Category[]
    const valid = stored.filter((item) => item?.id && item?.name)
    const defaultCategory = valid.find((item) => item.id === 'uncategorized') ?? defaultCategories[0]
    return [defaultCategory, ...valid.filter((item) => item.id !== 'uncategorized')]
  } catch {
    return defaultCategories
  }
}

function saveCategories(categories: Category[]) {
  localStorage.setItem(categoryStorageKey, JSON.stringify(categories))
}

function isBackgroundBackup(document: MindMapDocument) {
  return document.title.includes('（同步前备份）')
}

export function App() {
  const document = useEditorStore((state) => state.document)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectedRelationId = useEditorStore((state) => state.selectedRelationId)
  const past = useEditorStore((state) => state.past)
  const future = useEditorStore((state) => state.future)
  const hydrated = useEditorStore((state) => state.hydrated)
  const dispatch = useEditorStore((state) => state.dispatch)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const hydrate = useEditorStore((state) => state.hydrate)
  const createDocument = useEditorStore((state) => state.createDocument)
  const createQuickNote = useEditorStore((state) => state.createQuickNote)
  const requestNodeFocus = useEditorStore((state) => state.requestNodeFocus)
  const clipboard = useEditorStore((state) => state.clipboard)
  const [documents, setDocuments] = useState<MindMapDocument[]>([])
  const [categories, setCategories] = useState<Category[]>(loadCategories)
  const [activeCategoryId, setActiveCategoryId] = useState('all')
  const [categoryDraft, setCategoryDraft] = useState('')
  const [showCategoryInput, setShowCategoryInput] = useState(false)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [accountSession, setAccountSession] = useState<AuthSession | null>(loadAccountSession)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('mindtree.sidebar-collapsed') === 'true')
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(loadSyncConfig)
  const [syncRemoteVersion, setSyncRemoteVersion] = useState<number | null>(null)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [syncPreview, setSyncPreview] = useState<RemoteDocument | null>(null)
  const [syncConflict, setSyncConflict] = useState<RemoteDocument | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [historyBusy, setHistoryBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [attachmentStatus, setAttachmentStatus] = useState<string | null>(null)
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)
  const [draftSaveOpen, setDraftSaveOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftCategoryId, setDraftCategoryId] = useState('uncategorized')
  const [taskCenterOpen, setTaskCenterOpen] = useState(false)
  const pendingSaveRef = useRef<number | null>(null)
  const pendingSnapshotRef = useRef<number | null>(null)
  const observedVersionRef = useRef<{ documentId: string; updatedAt: number } | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const pendingTaskFocusRef = useRef<{ documentId: string; nodeId: string } | null>(null)
  const selectedNode = selectedNodeId ? document.nodes[selectedNodeId] : null
  const selectedRelation = selectedRelationId ? document.relations.find((relation) => relation.id === selectedRelationId) ?? null : null
  const theme = getTheme(document.theme.id)
  const libraryDocuments = useMemo(() => documents.filter((item) => !isBackgroundBackup(item)), [documents])
  const draftDocuments = useMemo(() => libraryDocuments.filter((item) => item.isDraft), [libraryDocuments])
  const savedDocuments = useMemo(() => libraryDocuments.filter((item) => !item.isDraft), [libraryDocuments])
  const visibleDocuments = useMemo(() => activeCategoryId === 'all'
    ? savedDocuments
    : savedDocuments.filter((item) => item.categoryId === activeCategoryId), [activeCategoryId, savedDocuments])
  const categoryName = (id: string) => categories.find((category) => category.id === id)?.name ?? '未分类'
  const taskDocuments = useMemo(() => [document, ...libraryDocuments.filter((item) => item.id !== document.id)], [document, libraryDocuments])
  const tasks = useMemo(() => collectTasks(taskDocuments), [taskDocuments])
  const openTaskCount = useMemo(() => tasks.filter((task) => task.status !== 'done').length, [tasks])

  const exportCurrentDocument = (mode: MarkdownExportMode) => {
    downloadMarkdown(document, mode)
    setExportOpen(false)
  }

  const addNodeLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedNode || !linkUrl.trim()) return
    if (dispatch({ type: 'ADD_NODE_LINK', nodeId: selectedNode.id, url: linkUrl, label: linkLabel })) {
      setLinkUrl('')
      setLinkLabel('')
    }
  }

  const uploadNodeAttachment = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !selectedNode) return
    if (file.size > 15 * 1024 * 1024) {
      setAttachmentStatus('单个附件最大 15 MB。')
      return
    }
    try {
      const attachment = await saveNodeAttachment(document.id, selectedNode.id, file)
      if (!dispatch({ type: 'ADD_NODE_ATTACHMENT', nodeId: selectedNode.id, attachment })) throw new Error('附件没有写入节点')
      setAttachmentStatus(`已添加 ${attachment.name}`)
    } catch {
      setAttachmentStatus('附件保存失败，请重试。')
    }
  }

  const downloadNodeAttachment = async (attachmentId: string) => {
    const stored = await getNodeAttachment(attachmentId)
    if (!stored) {
      setAttachmentStatus('附件仅存在于原浏览器，当前设备无法读取。')
      return
    }
    const url = URL.createObjectURL(stored.blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = stored.name
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const addCategory = () => {
    const name = categoryDraft.trim()
    if (!name) return
    const category = { id: `category-${crypto.randomUUID()}`, name }
    const next = [...categories, category]
    setCategories(next)
    saveCategories(next)
    setCategoryDraft('')
    setShowCategoryInput(false)
    setActiveCategoryId(category.id)
  }

  const beginCategoryEdit = (category: Category) => {
    setEditingCategoryId(category.id)
    setEditingCategoryName(category.name)
  }

  const renameCategory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = editingCategoryName.trim()
    if (!editingCategoryId || !name) return
    const next = categories.map((category) => category.id === editingCategoryId ? { ...category, name } : category)
    setCategories(next)
    saveCategories(next)
    setEditingCategoryId(null)
  }

  const deleteCategory = async (categoryId: string) => {
    if (categoryId === 'uncategorized') return
    const affected = documents.filter((item) => item.categoryId === categoryId)
    const now = Date.now()
    const reassigned = affected.map((item) => ({ ...item, categoryId: 'uncategorized', updatedAt: now }))
    try {
      await Promise.all(reassigned.map((item) => saveDocument(item)))
      setDocuments((current) => current.map((item) => reassigned.find((next) => next.id === item.id) ?? item))
      if (document.categoryId === categoryId) dispatch({ type: 'SET_CATEGORY', categoryId: 'uncategorized' })
      const next = categories.filter((category) => category.id !== categoryId)
      setCategories(next)
      saveCategories(next)
      setActiveCategoryId((current) => current === categoryId ? 'uncategorized' : current)
      setEditingCategoryId(null)
    } catch {
      // IndexedDB 写入失败时保留当前分类，避免导图与分类列表脱节。
    }
  }

  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed
      localStorage.setItem('mindtree.sidebar-collapsed', String(next))
      return next
    })
  }

  const persistDocument = useCallback(async (documentToSave: MindMapDocument) => {
    await saveDocument(documentToSave)
    setDocuments((current) => [documentToSave, ...current.filter((item) => item.id !== documentToSave.id)]
      .sort((left, right) => right.updatedAt - left.updatedAt))
  }, [])

  const flushCurrentDocument = useCallback(async () => {
    if (!hydrated) return
    if (pendingSaveRef.current !== null) {
      window.clearTimeout(pendingSaveRef.current)
      pendingSaveRef.current = null
    }
    await persistDocument(useEditorStore.getState().document)
  }, [hydrated, persistDocument])

  const refreshVersions = useCallback(() => {
    void listDocumentVersions(useEditorStore.getState().document.id).then(setVersions).catch(console.warn)
  }, [])

  const createManualSnapshot = useCallback(async () => {
    try {
      setHistoryBusy(true)
      const current = useEditorStore.getState().document
      await saveDocumentVersion(createDocumentVersion(current, 'manual', '手动快照'))
      refreshVersions()
    } finally {
      setHistoryBusy(false)
    }
  }, [refreshVersions])

  const restoreVersion = useCallback(async (version: DocumentVersion) => {
    try {
      setHistoryBusy(true)
      await flushCurrentDocument()
      const current = useEditorStore.getState().document
      await saveDocumentVersion(createDocumentVersion(current, 'restore-point', '恢复前备份'))
      const restored = restoreDocumentVersion(version, current)
      await persistDocument(restored)
      observedVersionRef.current = { documentId: restored.id, updatedAt: restored.updatedAt }
      hydrate(restored)
      refreshVersions()
    } finally {
      setHistoryBusy(false)
    }
  }, [flushCurrentDocument, hydrate, persistDocument, refreshVersions])

  const duplicateVersion = useCallback(async (version: DocumentVersion) => {
    try {
      setHistoryBusy(true)
      await flushCurrentDocument()
      const duplicate = duplicateDocumentVersion(version)
      await saveDocument(duplicate)
      setDocuments((current) => [duplicate, ...current].sort((left, right) => right.updatedAt - left.updatedAt))
      observedVersionRef.current = { documentId: duplicate.id, updatedAt: duplicate.updatedAt }
      hydrate(duplicate)
      setHistoryOpen(false)
    } finally {
      setHistoryBusy(false)
    }
  }, [flushCurrentDocument, hydrate])

  const runNavigation = useCallback(async (navigation: PendingNavigation) => {
    await flushCurrentDocument()
    if (navigation.kind === 'open') hydrate(navigation.document)
    if (navigation.kind === 'new-map') {
      createDocument()
      setActiveCategoryId('uncategorized')
    }
    if (navigation.kind === 'quick-note') {
      createQuickNote()
      setActiveCategoryId('all')
    }
  }, [createDocument, createQuickNote, flushCurrentDocument, hydrate])

  const requestNavigation = useCallback((navigation: PendingNavigation) => {
    if (!document.isDraft) {
      void runNavigation(navigation)
      return
    }
    setDraftTitle(document.title)
    setDraftCategoryId(document.categoryId)
    setPendingNavigation(navigation)
    setDraftSaveOpen(true)
  }, [document.categoryId, document.isDraft, document.title, runNavigation])

  const openDocument = useCallback((nextDocument: MindMapDocument) => {
    if (nextDocument.id !== document.id) requestNavigation({ kind: 'open', document: nextDocument })
  }, [document.id, requestNavigation])

  const startNewDocument = useCallback(() => requestNavigation({ kind: 'new-map' }), [requestNavigation])
  const startQuickNote = useCallback(() => requestNavigation({ kind: 'quick-note' }), [requestNavigation])

  const openTask = useCallback((task: MindTreeTask) => {
    setTaskCenterOpen(false)
    if (task.documentId === document.id) {
      if (dispatch({ type: 'REVEAL_NODE', nodeId: task.nodeId })) requestNodeFocus(task.nodeId)
      return
    }
    const target = taskDocuments.find((item) => item.id === task.documentId)
    if (!target) return
    pendingTaskFocusRef.current = { documentId: task.documentId, nodeId: task.nodeId }
    openDocument(target)
  }, [dispatch, document.id, openDocument, requestNodeFocus, taskDocuments])

  const updateTaskStatus = useCallback(async (task: MindTreeTask, taskStatus: 'todo' | 'doing' | 'done') => {
    const target = taskDocuments.find((item) => item.id === task.documentId)
    if (!target) return
    if (target.id === document.id) {
      dispatch({ type: 'SET_NODE_TASK_STATUS', nodeId: task.nodeId, taskStatus })
      return
    }
    try {
      const updated = executeCommand(target, { type: 'SET_NODE_TASK_STATUS', nodeId: task.nodeId, taskStatus }).document
      await persistDocument(updated)
    } catch (error) { console.warn(error) }
  }, [dispatch, document.id, persistDocument, taskDocuments])

  const closeDraftSave = () => {
    setDraftSaveOpen(false)
    setPendingNavigation(null)
  }

  const keepDraftAndNavigate = async () => {
    const navigation = pendingNavigation
    closeDraftSave()
    if (navigation) await runNavigation(navigation)
  }

  const saveDraftAndNavigate = async () => {
    if (!document.isDraft) return
    if (!dispatch({ type: 'SAVE_QUICK_NOTE', title: draftTitle, categoryId: draftCategoryId })) return
    const saved = useEditorStore.getState().document
    await persistDocument(saved)
    await saveDocumentVersion(createDocumentVersion(saved, 'manual', '保存随手记')).catch(console.warn)
    const navigation = pendingNavigation
    closeDraftSave()
    if (navigation) await runNavigation(navigation)
  }

  useEffect(() => {
    const handleQuickNoteShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'n') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      startQuickNote()
    }
    window.addEventListener('keydown', handleQuickNoteShortcut)
    return () => window.removeEventListener('keydown', handleQuickNoteShortcut)
  }, [startQuickNote])

  const saveSyncSettings = useCallback((nextConfig: SyncConfig) => {
    saveSyncConfig(nextConfig)
    setSyncConfig(nextConfig)
    setSyncStatus('连接设置已保存在此浏览器。')
  }, [])

  const authenticateAccount = useCallback(async (mode: 'login' | 'register', email: string, password: string) => {
    const session = mode === 'login'
      ? await loginAccount({ serverUrl: syncConfig.serverUrl }, email, password)
      : await registerAccount({ serverUrl: syncConfig.serverUrl }, email, password)
    saveAccountSession(session)
    setAccountSession(session)
    saveSyncSettings({ serverUrl: syncConfig.serverUrl, token: session.token })
    setLoginOpen(false)
  }, [saveSyncSettings, syncConfig.serverUrl])

  const logoutAccount = async () => {
    if (accountSession) await revokeAccountSession({ serverUrl: syncConfig.serverUrl }, accountSession.token).catch(() => undefined)
    clearAccountSession()
    setAccountSession(null)
    saveSyncSettings({ serverUrl: syncConfig.serverUrl, token: '' })
    setAccountMenuOpen(false)
  }

  const uploadToCloud = useCallback(async (config: SyncConfig) => {
    if (document.isDraft) {
      setSyncStatus('随手记草稿仅保存在本机。请先保存为正式导图后再同步。')
      return
    }
    try {
      setSyncBusy(true)
      setSyncStatus(null)
      setSyncPreview(null)
      setSyncConflict(null)
      saveSyncSettings({ serverUrl: config.serverUrl.trim(), token: config.token.trim() })
      await flushCurrentDocument()
      const metadata = await getSyncMetadata(document.id)
      const result = await pushDocument(config, document, metadata?.remoteVersion ?? 0)
      if (result.type === 'conflict') {
        setSyncConflict(result.remote)
        setSyncStatus('云端已有较新的版本，本地内容未被上传。')
        return
      }
      await saveSyncMetadata({ documentId: document.id, remoteVersion: result.remote.version, syncedAt: Date.now() })
      setSyncRemoteVersion(result.remote.version)
      setSyncStatus(`已上传到云端 · v${result.remote.version}`)
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : '上传失败，请检查服务地址与 Token。')
    } finally {
      setSyncBusy(false)
    }
  }, [document, flushCurrentDocument, saveSyncSettings])

  const checkCloudVersion = useCallback(async (config: SyncConfig) => {
    if (document.isDraft) {
      setSyncStatus('随手记草稿仅保存在本机。请先保存为正式导图后再同步。')
      return
    }
    try {
      setSyncBusy(true)
      setSyncStatus(null)
      setSyncConflict(null)
      saveSyncSettings({ serverUrl: config.serverUrl.trim(), token: config.token.trim() })
      const remote = await fetchRemoteDocument(config, document.id)
      if (!remote) {
        setSyncPreview(null)
        setSyncStatus('云端还没有这份导图，请先上传本地版本。')
        return
      }
      setSyncPreview(remote)
      setSyncStatus('已读取云端版本，请确认后再替换本地内容。')
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : '读取云端版本失败。')
    } finally {
      setSyncBusy(false)
    }
  }, [document.id, saveSyncSettings])

  const createDevicePairing = useCallback(async (config: SyncConfig) => {
    saveSyncSettings({ serverUrl: config.serverUrl.trim(), token: config.token.trim() })
    return createPairingInvite(config)
  }, [saveSyncSettings])

  const redeemDevicePairing = useCallback(async (invite: PairingInvite) => {
    const token = await redeemPairingInvite(invite)
    const nextConfig = { serverUrl: invite.serverUrl, token }
    saveSyncSettings(nextConfig)
    setSyncStatus('扫码配对成功，已保存此设备的同步连接。')
    return nextConfig
  }, [saveSyncSettings])

  // 拉取云端版本并替换本地：先建一份「同步前备份」，再写入云端内容并 hydrate。
  // 自动拉取与手动确认拉取共用此逻辑，保证两种入口都不会覆盖未同步的本地工作。
  const pullRemoteDocument = useCallback(async (remote: RemoteDocument) => {
    const currentDoc = useEditorStore.getState().document
    if (currentDoc.id !== remote.payload.id) return
    const now = Date.now()
    await saveDocumentVersion(createDocumentVersion(currentDoc, 'sync-backup', '同步前备份'))
    await saveDocument(remote.payload)
    await saveSyncMetadata({ documentId: remote.payload.id, remoteVersion: remote.version, syncedAt: now })
    setDocuments((current) => [remote.payload, ...current.filter((item) => item.id !== remote.payload.id)]
      .sort((left, right) => right.updatedAt - left.updatedAt))
    hydrate(remote.payload)
    setSyncRemoteVersion(remote.version)
  }, [hydrate])

  const autoSyncRef = useRef(false)
  // 自动同步：打开应用或切换文档时静默检查云端。本地无未上传修改时直接拉取较新版本；
  // 本地也改过时只提示冲突，不自动覆盖（保守，绝不丢本地工作）。未配置 Token 则跳过。
  const autoSync = useCallback(async (config: SyncConfig) => {
    if (autoSyncRef.current || !config.token.trim()) return
    autoSyncRef.current = true
    try {
      const currentDoc = useEditorStore.getState().document
      if (currentDoc.isDraft) return
      const metadata = await getSyncMetadata(currentDoc.id)
      const remote = await fetchRemoteDocument(config, currentDoc.id)
      if (!remote) return
      if (metadata && remote.version <= metadata.remoteVersion) return
      setSyncRemoteVersion(remote.version)
      // 本地在上次同步后是否改动过（留 2s 容差应对防抖保存）。
      const localDirty = !metadata || currentDoc.updatedAt > metadata.syncedAt + 2000
      if (localDirty) {
        setSyncPreview(null)
        setSyncConflict(remote)
        setSyncStatus(`云端有新版本 v${remote.version}，但本地也有未上传的修改，已暂停自动同步。请打开「同步」手动决定。`)
        return
      }
      await pullRemoteDocument(remote)
      setSyncStatus(`已自动同步云端版本 v${remote.version}`)
    } catch {
      // 自动同步静默失败，不打扰用户；可在「同步」里手动重试。
    } finally {
      autoSyncRef.current = false
    }
  }, [pullRemoteDocument])

  const confirmCloudPull = useCallback(async () => {
    const remote = syncConflict ?? syncPreview
    if (!remote) return
    try {
      setSyncBusy(true)
      await flushCurrentDocument()
      await pullRemoteDocument(remote)
      setSyncPreview(null)
      setSyncConflict(null)
      setSyncStatus(`已拉取云端版本 v${remote.version}；本地备份已创建。`)
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : '拉取云端版本失败。')
    } finally {
      setSyncBusy(false)
    }
  }, [flushCurrentDocument, pullRemoteDocument, syncConflict, syncPreview])

  // ── 初始化：从 IndexedDB 并行加载最新文档和文档列表 ─────────────────────────
  // hydrate() 恢复画布状态；setDocuments() 填充左侧导图列表。
  useEffect(() => {
    Promise.all([loadLatestDocument(), listDocuments()]).then(([saved, library]) => {
      const activeDocument = saved ?? document
      hydrate(activeDocument)
      setDocuments(library.length ? library : [activeDocument])
    }).catch(() => {
      hydrate(document)
      setDocuments([document])
    })
    // Hydration only runs once. The initial document is a safe fallback when IndexedDB is empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 自动保存：每次 document 变化后 450ms 防抖写入 IndexedDB ─────────────────
  useEffect(() => {
    if (!hydrated) return
    pendingSaveRef.current = window.setTimeout(() => {
      pendingSaveRef.current = null
      persistDocument(document).catch(console.warn)
    }, 450)
    return () => {
      if (pendingSaveRef.current !== null) {
        window.clearTimeout(pendingSaveRef.current)
        pendingSaveRef.current = null
      }
    }
  }, [document, hydrated, persistDocument])

  // 草稿虽已自动保存到本机，离开页面时仍提示用户决定是否转为正式导图。
  useEffect(() => {
    if (!document.isDraft) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [document.isDraft])

  // 自动快照独立于 450ms 自动保存：用户停止编辑 3 秒后才记录，避免每次键入都产生历史版本。
  useEffect(() => {
    if (!hydrated) return
    const previous = observedVersionRef.current
    if (!previous || previous.documentId !== document.id) {
      observedVersionRef.current = { documentId: document.id, updatedAt: document.updatedAt }
      return
    }
    if (document.updatedAt <= previous.updatedAt) return
    pendingSnapshotRef.current = window.setTimeout(() => {
      const snapshot = createDocumentVersion(document, 'auto')
      void saveDocumentVersion(snapshot).then(() => {
        observedVersionRef.current = { documentId: document.id, updatedAt: document.updatedAt }
        if (historyOpen) refreshVersions()
      }).catch(console.warn)
      pendingSnapshotRef.current = null
    }, 3_000)
    return () => {
      if (pendingSnapshotRef.current !== null) {
        window.clearTimeout(pendingSnapshotRef.current)
        pendingSnapshotRef.current = null
      }
    }
  }, [document, historyOpen, hydrated, refreshVersions])

  useEffect(() => {
    getSyncMetadata(document.id).then((metadata) => setSyncRemoteVersion(metadata?.remoteVersion ?? null)).catch(() => setSyncRemoteVersion(null))
  }, [document.id])

  useEffect(() => {
    const pending = pendingTaskFocusRef.current
    if (!pending || pending.documentId !== document.id) return
    pendingTaskFocusRef.current = null
    if (dispatch({ type: 'REVEAL_NODE', nodeId: pending.nodeId })) requestNodeFocus(pending.nodeId)
  }, [dispatch, document.id, requestNodeFocus])

  // 自动同步触发：每次打开应用或切换文档后，静默拉取云端较新版本。
  useEffect(() => {
    if (!hydrated) return
    const config = loadSyncConfig()
    if (!config.token.trim()) return
    void autoSync(config)
  }, [document.id, hydrated, autoSync])

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`} style={{
      '--app-bg': theme.canvas,
      '--chrome-bg': theme.chrome,
      '--panel-bg': theme.surface,
      '--app-text': theme.nodeText,
      '--muted-text': theme.id === 'cyber' || theme.id === 'midnight' ? '#aab4c8' : '#898a80',
      '--line': theme.nodeBorder,
      '--accent': theme.selected,
    } as CSSProperties}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">M</span>
          <span>MindTree</span>
        </div>
        <div className="document-title">
          <input value={document.title} aria-label="导图标题" onChange={(event) => dispatch({ type: 'RENAME_DOCUMENT', title: event.target.value })} />
          <span className="save-state">{hydrated ? document.isDraft ? '随手记草稿 · 已本机保存' : '已本地保存' : '正在打开…'}</span>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" onClick={undo} disabled={!past.length} title="撤销 (⌘Z)"><Icon>↶</Icon></button>
          <button className="icon-button" onClick={redo} disabled={!future.length} title="重做 (⇧⌘Z)"><Icon>↷</Icon></button>
          <span className="toolbar-divider" />
          <button className="toolbar-button" onClick={() => dispatch({ type: 'ADD_CHILD', parentId: selectedNodeId ?? document.rootId })}><Icon>＋</Icon>子节点</button>
          <button className="toolbar-button toolbar-button--dark" disabled={(selectedNodeId ?? document.rootId) === document.rootId} onClick={() => dispatch({ type: 'ADD_SIBLING', nodeId: selectedNodeId ?? document.rootId })}><Icon>↳</Icon>同级</button>
          <button className="toolbar-button" onClick={() => dispatch({ type: 'AUTO_ARRANGE' })} title="自动排列并保留当前自由排布"><Icon>↺</Icon>排列</button>
          <button className="toolbar-button" onClick={() => setHistoryOpen(true)} title="查看或恢复本地版本"><Icon>◷</Icon>历史</button>
          <span className="export-menu-wrap"><button className="toolbar-button" onClick={() => setExportOpen((open) => !open)} title="导出 Markdown"><Icon>⇩</Icon>导出</button>{exportOpen && <span className="export-menu"><button onClick={() => exportCurrentDocument('outline')}>导出 Markdown 大纲</button><button onClick={() => exportCurrentDocument('minutes')}>导出会议纪要</button><button onClick={() => exportCurrentDocument('ai-context')}>导出 AI 上下文</button></span>}</span>
          <button className="toolbar-button" onClick={() => setSyncOpen(true)} title="上传或拉取云端导图"><Icon>⇅</Icon>同步</button>
          {document.isDraft && <button className="toolbar-button toolbar-button--dark" onClick={() => { setDraftTitle(document.title); setDraftCategoryId(document.categoryId); setPendingNavigation(null); setDraftSaveOpen(true) }} title="将随手记保存为正式导图"><Icon>✓</Icon>保存随手记</button>}
        </div>
      </header>

      <section className="workspace">
        <aside className="left-rail">
          {sidebarCollapsed ? (
            <button className="sidebar-expand" onClick={toggleSidebar} title="展开侧栏" aria-label="展开侧栏"><span>M</span><i>›</i></button>
          ) : <>
          <div className="sidebar-scroll">
            <div className="sidebar-workspace-name"><span className="sidebar-workspace-mark">M</span><strong>我的工作区</strong><button onClick={toggleSidebar} aria-label="收起侧栏" title="收起侧栏">‹</button></div>
            <button className="sidebar-quick-note" onClick={() => { void startQuickNote() }}><span>✦</span><span><strong>随手记</strong><small>快速梳理一个想法</small></span><i>⌘⇧N</i></button>
            <button className="sidebar-create sidebar-create--secondary" onClick={() => { void startNewDocument() }}><span>＋</span>新建导图</button>

            {draftDocuments.length > 0 && <section className="sidebar-section sidebar-drafts">
              <div className="sidebar-section__heading"><p className="sidebar-section__title">随手记草稿</p><span>{draftDocuments.length}</span></div>
              {draftDocuments.map((item) => <button key={item.id} className={`sidebar-document ${item.id === document.id ? 'is-active' : ''}`} onClick={() => openDocument(item)}><span className="sidebar-document__icon">✦</span><span className="sidebar-document__copy"><strong>{item.title}</strong><small>已自动保存到本机</small></span></button>)}
            </section>}

            <section className="sidebar-section">
              <p className="sidebar-section__title">项目</p>
              <button className={`sidebar-nav-item ${activeCategoryId === 'all' ? 'is-active' : ''}`} onClick={() => setActiveCategoryId('all')}><span>◫</span>全部导图 <small>{savedDocuments.length}</small></button>
              {categories.map((category) => {
                const count = savedDocuments.filter((item) => item.categoryId === category.id).length
                return editingCategoryId === category.id ? <form key={category.id} className="sidebar-category-form sidebar-category-form--editing" onSubmit={renameCategory}>
                  <input autoFocus value={editingCategoryName} onChange={(event) => setEditingCategoryName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setEditingCategoryId(null) } }} aria-label="分类名称" />
                  <button type="submit">保存</button>{category.id !== 'uncategorized' && <button type="button" className="sidebar-category-delete" onClick={() => { void deleteCategory(category.id) }}>删除</button>}
                </form> : <button key={category.id} className={`sidebar-nav-item ${activeCategoryId === category.id ? 'is-active' : ''}`} onClick={() => setActiveCategoryId(category.id)} onDoubleClick={(event) => { event.preventDefault(); beginCategoryEdit(category) }} title="双击重命名"><span>⌁</span>{category.name}<small>{count}</small></button>
              })}
              {showCategoryInput ? (
                <form className="sidebar-category-form" onSubmit={(event) => { event.preventDefault(); addCategory() }}>
                  <input autoFocus value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} placeholder="分类名称" />
                  <button type="submit">添加</button>
                </form>
              ) : <button className="sidebar-add-category" onClick={() => setShowCategoryInput(true)}>＋ 新建分类</button>}
            </section>

            <section className="sidebar-section sidebar-documents">
              <div className="sidebar-section__heading"><p className="sidebar-section__title">导图记录</p><span>{activeCategoryId === 'all' ? '全部' : categoryName(activeCategoryId)}</span></div>
              {visibleDocuments.map((item) => (
                <button key={item.id} className={`sidebar-document ${item.id === document.id ? 'is-active' : ''}`} onClick={() => { void openDocument(item) }}>
                  <span className="sidebar-document__icon">◈</span><span className="sidebar-document__copy"><strong>{item.title}</strong><small>{categoryName(item.categoryId)}</small></span>
                </button>
              ))}
              {!visibleDocuments.length && <p className="sidebar-empty">此分类暂时没有导图</p>}
              <label className="sidebar-category-select">当前导图分类
                <select value={document.categoryId} onChange={(event) => { dispatch({ type: 'SET_CATEGORY', categoryId: event.target.value }); setActiveCategoryId(event.target.value) }}>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
            </section>

            <section className="sidebar-section sidebar-assistant-section">
              <button className="sidebar-task-entry" onClick={() => setTaskCenterOpen(true)}><span>☑</span><span><strong>任务中心</strong><small>跨导图查看待办</small></span><i>{openTaskCount}</i></button>
            </section>
            <section className="sidebar-section sidebar-assistant-section">
              <p className="sidebar-section__title">助手</p>
              <AiAssistant document={document} targetNodeId={selectedNodeId ?? document.rootId} />
            </section>
          </div>
          <footer className="sidebar-footer">
            <button className="sidebar-footer-action" type="button"><span>⚙</span>设置</button>
            <button className="sidebar-footer-action" type="button"><span>?</span>帮助与反馈</button>
            <div className="sidebar-account">
              <button className="sidebar-account__trigger" onClick={() => setAccountMenuOpen((open) => !open)}><span className="sidebar-avatar">{accountSession?.user.email.slice(0, 1).toUpperCase() ?? 'M'}</span><span><strong>{accountSession?.user.email ?? '本地工作区'}</strong><small>{accountSession ? '已登录 · 可同步' : '未登录 · 本地保存'}</small></span><i>⋮</i></button>
              {accountMenuOpen && <div className="sidebar-account__menu"><strong>{accountSession ? '已登录账号' : '同步账号'}</strong><p>{accountSession ? '此账号的同步数据与其他账号隔离。' : '登录后可使用账号会话安全同步导图。'}</p>{accountSession ? <button onClick={() => { void logoutAccount() }}>退出登录</button> : <button onClick={() => { setLoginOpen(true); setAccountMenuOpen(false) }}>登录 / 注册</button>}</div>}
            </div>
          </footer>
          </>}
        </aside>

        <MindMapCanvas />

        <aside className="inspector">
          <p className="eyebrow">{selectedRelation ? '关系属性' : selectedNode ? '节点属性' : '文档设置'}</p>
          {selectedRelation ? (
            <>
              <label className="field-label" htmlFor="relation-label">关系说明</label>
              <textarea
                id="relation-label"
                value={selectedRelation.label}
                rows={2}
                onChange={(event) => dispatch({ type: 'UPDATE_RELATION_LABEL', relationId: selectedRelation.id, label: event.target.value })}
              />
              <div className="property-row"><span>起点</span><strong>{document.nodes[selectedRelation.sourceId]?.topic ?? '已删除节点'}</strong></div>
              <div className="property-row"><span>终点</span><strong>{document.nodes[selectedRelation.targetId]?.topic ?? '已删除节点'}</strong></div>
              <button className="danger-button" onClick={() => dispatch({ type: 'DELETE_RELATION', relationId: selectedRelation.id })}>删除此关系</button>
            </>
          ) : selectedNode ? (
            <>
              <label className="field-label" htmlFor="topic">主题</label>
              <textarea
                id="topic"
                value={selectedNode.topic}
                rows={3}
                onChange={(event) => dispatch({ type: 'UPDATE_NODE_TOPIC', nodeId: selectedNode.id, topic: event.target.value })}
              />
              <div className="node-marker-controls">
                <label>任务状态
                  <select value={selectedNode.taskStatus} onChange={(event) => dispatch({ type: 'SET_NODE_TASK_STATUS', nodeId: selectedNode.id, taskStatus: event.target.value as typeof selectedNode.taskStatus })}>
                    <option value="none">普通主题</option>
                    <option value="todo">待办</option>
                    <option value="doing">进行中</option>
                    <option value="done">已完成</option>
                  </select>
                </label>
                <label>优先级
                  <select value={selectedNode.priority} onChange={(event) => dispatch({ type: 'SET_NODE_PRIORITY', nodeId: selectedNode.id, priority: Number(event.target.value) as typeof selectedNode.priority })}>
                    <option value="0">未设置</option>
                    <option value="1">P1 · 高</option>
                    <option value="2">P2 · 中</option>
                    <option value="3">P3 · 低</option>
                  </select>
                </label>
                <label className="node-marker-controls__due-date">截止日期
                  <input type="date" value={selectedNode.dueDate ?? ''} disabled={selectedNode.taskStatus === 'none'} onChange={(event) => dispatch({ type: 'SET_NODE_DUE_DATE', nodeId: selectedNode.id, dueDate: event.target.value || null })} />
                </label>
              </div>
              <label className="field-label" htmlFor="node-note">备注</label>
              <GhostNoteEditor
                value={selectedNode.note}
                document={document}
                nodeId={selectedNode.id}
                onChange={(note) => dispatch({ type: 'UPDATE_NODE_NOTE', nodeId: selectedNode.id, note })}
              />
              <div className="node-resource-section"><p className="field-label">链接</p>
                {selectedNode.links.map((link) => <div className="node-resource" key={link.id}><a href={link.url} target="_blank" rel="noreferrer" title={link.url}>{link.label}</a><button onClick={() => dispatch({ type: 'DELETE_NODE_LINK', nodeId: selectedNode.id, linkId: link.id })} aria-label={`删除链接 ${link.label}`}>×</button></div>)}
                <form className="node-link-form" onSubmit={addNodeLink}><input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://…" type="url" /><input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} placeholder="链接名称（可选）" /><button type="submit">添加链接</button></form>
              </div>
              <div className="node-resource-section"><p className="field-label">附件</p>
                {selectedNode.attachments.map((attachment) => <div className="node-resource" key={attachment.id}><button className="node-resource__file" onClick={() => { void downloadNodeAttachment(attachment.id) }} title="下载本机附件">⌁ {attachment.name}<small>{Math.max(1, Math.ceil(attachment.size / 1024))} KB</small></button><button onClick={() => dispatch({ type: 'DELETE_NODE_ATTACHMENT', nodeId: selectedNode.id, attachmentId: attachment.id })} aria-label={`移除附件 ${attachment.name}`}>×</button></div>)}
                <input ref={attachmentInputRef} className="node-attachment-input" type="file" onChange={(event) => { void uploadNodeAttachment(event) }} />
                <button className="subtle-button" onClick={() => attachmentInputRef.current?.click()}>添加本机附件</button>
                <small className="node-resource__hint">单个文件最大 15 MB，不会自动上传云端。</small>
                {attachmentStatus && <small className="node-resource__hint">{attachmentStatus}</small>}
              </div>
              <div className="property-row"><span>子节点</span><strong>{selectedNode.childIds.length}</strong></div>
              <div className="property-row"><span>状态</span><strong>{selectedNode.collapsed ? '已折叠' : '已展开'}</strong></div>
              <button className="subtle-button" onClick={() => dispatch({ type: 'RESET_NODE_OFFSET', nodeId: selectedNode.id })}>重置节点位置</button>
              <button className="danger-button" disabled={selectedNode.id === document.rootId} onClick={() => dispatch({ type: 'DELETE_NODE', nodeId: selectedNode.id })}>删除此分支</button>
            </>
          ) : (
            <p className="empty-inspector">选择一个节点，即可编辑内容和查看分支信息。</p>
          )}
          <div className="theme-picker">
            <p className="eyebrow">主题</p>
            <div className="theme-grid">
              {themes.map((candidate) => (
                <button
                  key={candidate.id}
                  className={`theme-option ${candidate.id === theme.id ? 'is-active' : ''}`}
                  onClick={() => dispatch({ type: 'APPLY_THEME', themeId: candidate.id })}
                  title={candidate.description}
                >
                  <span className="theme-preview" style={{ background: candidate.canvas }}>
                    <i style={{ background: candidate.rootBackground }} />
                    {candidate.palette.slice(0, 3).map((color) => <b key={color} style={{ background: color }} />)}
                  </span>
                  <span>{candidate.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="layout-controls">
            <p className="eyebrow">布局</p>
            <label>层级间距 <output>{document.layout.levelGap}</output></label>
            <input type="range" min="48" max="180" value={document.layout.levelGap} onChange={(event) => dispatch({ type: 'UPDATE_LAYOUT', layout: { levelGap: Number(event.target.value) } })} />
            <label>同级间距 <output>{document.layout.siblingGap}</output></label>
            <input type="range" min="8" max="72" value={document.layout.siblingGap} onChange={(event) => dispatch({ type: 'UPDATE_LAYOUT', layout: { siblingGap: Number(event.target.value) } })} />
          </div>
        </aside>
      </section>

      <footer className="statusbar">
        <span><i className="status-dot" />本地优先</span>
        <span>{Object.keys(document.nodes).length} 个节点</span>
        {document.relations.length > 0 && <span>{document.relations.length} 条关系</span>}
        <span>{syncRemoteVersion === null ? '仅本地' : `云端 v${syncRemoteVersion}`}</span>
        {syncStatus && <span>{syncStatus}</span>}
        {clipboard && <span>已复制「{clipboard.topic}」</span>}
        <span className="status-hint">拖动根节点移动整图 · 右键“创建关系”后选择目标节点 · Shift+拖动调整结构 · ⌘K 命令</span>
      </footer>
      <SyncDialog
        open={syncOpen}
        config={syncConfig}
        remoteVersion={syncRemoteVersion}
        status={syncStatus}
        remotePreview={syncPreview}
        conflict={syncConflict}
        busy={syncBusy}
        onClose={() => setSyncOpen(false)}
        onSaveConfig={saveSyncSettings}
        onPush={uploadToCloud}
        onCheckPull={checkCloudVersion}
        onConfirmPull={confirmCloudPull}
        onCreatePairing={createDevicePairing}
        onRedeemPairing={redeemDevicePairing}
      />
      <VersionHistoryDialog
        open={historyOpen}
        documentTitle={document.title}
        versions={versions}
        busy={historyBusy}
        onClose={() => setHistoryOpen(false)}
        onRefresh={refreshVersions}
        onCreateSnapshot={() => { void createManualSnapshot() }}
        onRestore={(version) => { void restoreVersion(version) }}
        onDuplicate={(version) => { void duplicateVersion(version) }}
      />
      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} onSubmit={authenticateAccount} />
      {taskCenterOpen && <TaskCenterDialog tasks={tasks} onClose={() => setTaskCenterOpen(false)} onOpenTask={openTask} onSetStatus={(task, status) => { void updateTaskStatus(task, status) }} />}
      {draftSaveOpen && <div className="draft-save-layer" role="dialog" aria-modal="true" aria-labelledby="draft-save-title">
        <section className="draft-save-dialog">
          <span className="draft-save-dialog__mark">✦</span>
          <p className="eyebrow">随手记</p>
          <h2 id="draft-save-title">{pendingNavigation ? '先处理这份随手记' : '保存随手记'}</h2>
          <p>{pendingNavigation ? '它已自动保存在本机。保存后会成为正式导图并可参与同步；也可以暂时保留为草稿。' : '保存后会成为正式导图，并可在其他已登录设备上同步。'}</p>
          <label>导图名称<input autoFocus value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveDraftAndNavigate() } }} /></label>
          <label>保存到分类<select value={draftCategoryId} onChange={(event) => setDraftCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <div className="draft-save-dialog__actions">
            <button className="draft-save-dialog__primary" onClick={() => { void saveDraftAndNavigate() }}>保存为正式导图</button>
            {pendingNavigation && <button className="draft-save-dialog__secondary" onClick={() => { void keepDraftAndNavigate() }}>保留草稿并切换</button>}
            <button className="draft-save-dialog__cancel" onClick={closeDraftSave}>继续编辑</button>
          </div>
        </section>
      </div>}
    </main>
  )
}
