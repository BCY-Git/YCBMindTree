/**
 * App — 应用根组件，组装整体布局和各功能模块。
 *
 * 整体布局为三行：顶部工具栏（topbar）→ 工作区（workspace）→ 状态栏（statusbar）。
 * 工作区为四个可组合区域：左侧工作区 → 画布 → 右侧 AI 工作台 → 属性检查器。
 *
 * 生命周期：
 * 1. 挂载时从 IndexedDB 并行加载最新文档和文档列表（hydrate + setDocuments）
 * 2. 每次 document 变化后 450ms 防抖自动保存，并更新文档列表
 *
 * 所有命令通过 dispatch() 派发，状态由 useEditorStore 统一管理。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { MindMapCanvas } from '../editor/MindMapCanvas'
import { deleteLocalDocument, deleteSyncMetadata, getNodeAttachment, getSyncMetadata, listAllDepositBatches, listAllDepositProvenance, listAllDocumentVersions, listAllWorkflowSessions, listDocumentVersions, listDocuments, listStoredAttachments, loadDocument, loadLatestDocument, pruneStoredAttachmentsForDocument, restoreWorkspaceData, saveDocument, saveDocumentVersion, saveNodeAttachment, saveSyncMetadata, setDepositBatchAppliedState } from '../persistence/database'
import { readImagePresentation } from '../attachments/image-presentation'
import { useEditorStore } from '../store/editor.store'
import { getTheme, themes } from '../domain/themes'
import { AiAssistant } from '../ai/AiAssistant'
import { AssistantDock, AssistantDockToggleButton, loadAssistantDockOpen, loadAssistantDockWidth, saveAssistantDockOpen, saveAssistantDockWidth, type AssistantContextScope, type AssistantTab } from '../ai/AssistantDock'
import { depositNudgeReason, shouldShowDepositNudge } from '../ai/deposit/deposit-nudge'
import { WorkspaceNavigator } from './WorkspaceNavigator'
import { documentKindLabels, documentKinds, type DocumentKind, type MindMapDocument, type NodeMark } from '../domain/document.types'
import { SyncDialog } from '../sync/SyncDialog'
import { createPairingInvite, fetchRemoteDocument, fetchRemoteDocuments, loadSyncConfig, pushDocument, redeemPairingInvite, saveSyncConfig, type PairingInvite, type RemoteDocument, type SyncConfig } from '../sync/sync-client'
import { isUntouchedStarterDocument, synchronizeAccountLibrary } from '../sync/account-library'
import { VersionHistoryDialog } from '../history/VersionHistoryDialog'
import { createDocumentVersion, duplicateDocumentVersion, restoreDocumentVersion, type DocumentVersion } from '../history/version-history'
import { randomUuid } from '../platform/random-uuid'
import { downloadMarkdown, type MarkdownExportMode } from '../export/markdown'
import { createImportedCopy, parseDocumentFile, saveDocumentToLocalFile } from '../export/document-file'
import { downloadOpml, parseOpml } from '../export/opml'
import { parseMarkdownOutline } from '../export/markdown-import'
import type { ImportedDocument } from '../export/import-document'
import { downloadDocumentSvg } from '../export/svg'
import { parseWorkspaceBackup, prepareWorkspaceRestore, saveWorkspaceBackupToLocalFile, type WorkspaceBackup } from '../export/workspace-backup'
import { GhostNoteEditor } from '../ai/GhostNoteEditor'
import { LoginDialog } from '../auth/LoginDialog'
import { clearAccountSession, loadAccountSession, loginAccount, registerAccount, revokeAccountSession, saveAccountSession, type AuthSession } from '../auth/account-client'
import { TaskCenterDialog } from '../tasks/TaskCenterDialog'
import { collectTasks, type MindTreeTask } from '../tasks/task-index'
import { executeCommand } from '../domain/commands'
import { QuickAssistant } from '../ai/QuickAssistant'
import { createTag, deleteTag, loadTags, recolorTag, renameTag, saveTags, type Tag } from '../domain/tag-library'
import { nodeMarkMeta, nodeMarkOrder } from '../domain/node-semantics'
import { emptyNodeFilter, hasActiveFilter, useNodeFilterStore } from '../editor/filter-store'
import { OutlineView } from '../outline/OutlineView'
import { buildFocusBreadcrumb } from '../focus/focus-projection'
import { NodeSearchDialog } from '../editor/NodeSearchDialog'
import { createInternalNodeLink, parseInternalNodeLink, resolveInternalNodeLink } from '../links/internal-link'
import { PresentationMode } from '../presentation/PresentationMode'
import { AttachmentImage } from '../attachments/AttachmentImage'
import { exportFileStatus, revealExportFile, type ExportFileResult } from '../export/export-file'
import { ProjectStatusPanel } from '../projects/ProjectStatusPanel'
import { MobileMoreMenu } from './MobileMoreMenu'
import { DesktopUtilityMenu } from './DesktopUtilityMenu'
import { buildProjectStatus } from '../projects/project-status'
import { PlanCenterDialog } from '../projects/PlanCenterDialog'
import { createProject, loadProjects, saveProjects, type WorkspaceProject } from '../projects/project-library'
import { ProjectOverviewDialog } from '../projects/ProjectOverviewDialog'
import type { DepositBatch, DepositProvenance } from '../ai/deposit/deposit-types'
import type { WorkflowSession } from '../ai/workflow/workflow-types'
import { EnterIcon, GearIcon, HamburgerMenuIcon, LightningBoltIcon, Link2Icon, MagnifyingGlassIcon, MixerHorizontalIcon, MixerVerticalIcon, PlusIcon, QuestionMarkCircledIcon, ReloadIcon, RotateCounterClockwiseIcon, TargetIcon } from '@radix-ui/react-icons'

// 工具栏图标包装组件（aria-hidden，不暴露给屏幕阅读器）。
function Icon({ children }: { children: ReactNode }) {
  return <span aria-hidden="true" className="toolbar-icon">{children}</span>
}

function SummaryIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h3c2.2 0 3.4 1.2 3.4 3.4v7.2C10.4 17.8 11.6 19 14 19" /><rect x="14" y="9" width="7" height="6" rx="1.5" /></svg>
}

function BoundaryIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5" strokeDasharray="2.5 2.5" /></svg>
}

type Category = { id: string; name: string }
type PendingNavigation =
  | { kind: 'open'; document: MindMapDocument }
  | { kind: 'new-map'; projectId: string | null; documentKind: DocumentKind }
  | { kind: 'quick-note' }

type InspectorTab = 'content' | 'tasks' | 'resources' | 'project' | 'map'
type UniversalImportCandidate = ImportedDocument & { format: 'OPML' | 'Markdown' }
type ExternalDocumentChange = { documentId: string; title: string; updatedAt: number }

const documentBroadcastChannelName = 'mindtree.document-saves.v1'

function toggleValue<T>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

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
  const selectedNodeIds = useEditorStore((state) => state.selectedNodeIds)
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
  const requestRelatedTopic = useEditorStore((state) => state.requestRelatedTopic)
  const clipboard = useEditorStore((state) => state.clipboard)
  const [documents, setDocuments] = useState<MindMapDocument[]>([])
  const [categories, setCategories] = useState<Category[]>(loadCategories)
  const [projects, setProjects] = useState<WorkspaceProject[]>(loadProjects)
  const [projectCreateOpen, setProjectCreateOpen] = useState(false)
  const [projectNameDraft, setProjectNameDraft] = useState('')
  const [projectDescriptionDraft, setProjectDescriptionDraft] = useState('')
  const [projectRenameTarget, setProjectRenameTarget] = useState<WorkspaceProject | null>(null)
  const [projectRenameDraft, setProjectRenameDraft] = useState('')
  const [documentRenameTarget, setDocumentRenameTarget] = useState<MindMapDocument | null>(null)
  const [documentRenameDraft, setDocumentRenameDraft] = useState('')
  const [planCenterOpen, setPlanCenterOpen] = useState(false)
  const [projectOverviewId, setProjectOverviewId] = useState<string | null>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [accountSession, setAccountSession] = useState<AuthSession | null>(loadAccountSession)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('mindtree.sidebar-collapsed') === 'true')
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => {
    const stored = localStorage.getItem('mindtree.inspector-collapsed')
    return stored === null ? true : stored === 'true'
  })
  const [assistantOpen, setAssistantOpen] = useState(loadAssistantDockOpen)
  const [assistantTab, setAssistantTab] = useState<AssistantTab>('chat')
  const [assistantContextScope, setAssistantContextScope] = useState<AssistantContextScope>('selection')
  const [mobilePanel, setMobilePanel] = useState<'navigation' | 'inspector' | null>(null)
  const [assistantDockWidth, setAssistantDockWidth] = useState(loadAssistantDockWidth)
  const [assistantDepositRequestId, setAssistantDepositRequestId] = useState(0)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('content')
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(loadSyncConfig)
  const [syncRemoteVersion, setSyncRemoteVersion] = useState<number | null>(null)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [syncPreview, setSyncPreview] = useState<RemoteDocument | null>(null)
  const [syncConflict, setSyncConflict] = useState<RemoteDocument | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const accountLibrarySyncKeyRef = useRef<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [historyBusy, setHistoryBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [internalLinkPickerOpen, setInternalLinkPickerOpen] = useState(false)
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false)
  const [linkStatus, setLinkStatus] = useState<string | null>(null)
  const [attachmentStatus, setAttachmentStatus] = useState<string | null>(null)
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)
  const [draftSaveOpen, setDraftSaveOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftCategoryId, setDraftCategoryId] = useState('uncategorized')
  const [taskCenterOpen, setTaskCenterOpen] = useState(false)
  const [tags, setTags] = useState<Tag[]>(loadTags)
  const [tagDraft, setTagDraft] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [workspaceView, setWorkspaceView] = useState<'map' | 'outline'>(() => localStorage.getItem('mindtree.workspace-view') === 'outline' ? 'outline' : 'map')
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [presentationStartNodeId, setPresentationStartNodeId] = useState<string | null>(null)
  const [localSaveStatus, setLocalSaveStatus] = useState<string | null>(null)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  const [externalDocumentChange, setExternalDocumentChange] = useState<ExternalDocumentChange | null>(null)
  const [importCandidate, setImportCandidate] = useState<MindMapDocument | null>(null)
  const [universalImportCandidate, setUniversalImportCandidate] = useState<UniversalImportCandidate | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [workspaceBackupCandidate, setWorkspaceBackupCandidate] = useState<WorkspaceBackup | null>(null)
  const [workspaceBackupBusy, setWorkspaceBackupBusy] = useState(false)
  const [workspaceBackupStatus, setWorkspaceBackupStatus] = useState<string | null>(null)
  const [projectStatusData, setProjectStatusData] = useState<{ batches: DepositBatch[]; provenance: DepositProvenance[]; workflowSessions: WorkflowSession[] }>({ batches: [], provenance: [], workflowSessions: [] })
  const [projectStatusRefreshing, setProjectStatusRefreshing] = useState(false)
  const [exportStatus, setExportStatus] = useState<{ message: string; path?: string } | null>(null)
  const [documentQuery, setDocumentQuery] = useState('')
  const pendingSaveRef = useRef<number | null>(null)
  const pendingSnapshotRef = useRef<number | null>(null)
  const deletedDocumentIdsRef = useRef(new Set<string>())
  const observedVersionRef = useRef<{ documentId: string; updatedAt: number } | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const workspaceBackupInputRef = useRef<HTMLInputElement>(null)
  const pendingNodeFocusRef = useRef<{ documentId: string; nodeId: string } | null>(null)
  const documentBroadcastRef = useRef<BroadcastChannel | null>(null)
  const tabIdRef = useRef(randomUuid())
  const selectedNode = selectedNodeId ? document.nodes[selectedNodeId] : null
  const hasDepositNudge = useMemo(() => !assistantOpen && shouldShowDepositNudge(document.id) && Boolean(depositNudgeReason(document, selectedNodeId ?? document.rootId)), [assistantOpen, document, selectedNodeId])
  const projectStatus = useMemo(() => selectedNode ? buildProjectStatus({ document, rootNodeId: selectedNode.id, ...projectStatusData }) : null, [document, projectStatusData, selectedNode])
  const focusBreadcrumb = useMemo(() => focusedNodeId ? buildFocusBreadcrumb(document, focusedNodeId) : [], [document, focusedNodeId])
  const canGroupSelection = useMemo(() => {
    if (selectedNodeIds.length < 2) return false
    const selected = selectedNodeIds.map((id) => document.nodes[id])
    const parentId = selected[0]?.parentId
    return Boolean(parentId && selected.every((node) => node && !node.isFreeTopic && node.parentId === parentId))
  }, [document.nodes, selectedNodeIds])
  const nodeFilter = useNodeFilterStore((state) => state.filter)
  const setNodeFilter = useNodeFilterStore((state) => state.setFilter)
  const clearNodeFilter = useNodeFilterStore((state) => state.clearFilter)
  const selectedRelation = selectedRelationId ? document.relations.find((relation) => relation.id === selectedRelationId) ?? null : null
  const theme = getTheme(document.theme.id)
  const libraryDocuments = useMemo(() => documents.filter((item) => !isBackgroundBackup(item)), [documents])
  const savedDocuments = useMemo(() => libraryDocuments.filter((item) => !item.isDraft), [libraryDocuments])
  const workspaceBackupCollisions = useMemo(() => workspaceBackupCandidate
    ? workspaceBackupCandidate.documents.filter((candidate) => documents.some((item) => item.id === candidate.id)).length
    : 0, [documents, workspaceBackupCandidate])
  const taskDocuments = useMemo(() => [document, ...libraryDocuments.filter((item) => item.id !== document.id)], [document, libraryDocuments])
  const pendingDepositDocumentIds = useMemo(() => new Set(projectStatusData.batches.filter((batch) => batch.status === 'pending' && batch.candidates.some((candidate) => candidate.status === 'pending' || candidate.status === 'accepted')).map((batch) => batch.sourceDocumentId)), [projectStatusData.batches])
  const currentPendingDepositCount = useMemo(() => projectStatusData.batches.filter((batch) => batch.sourceDocumentId === document.id && batch.status === 'pending').reduce((count, batch) => count + batch.candidates.filter((candidate) => candidate.status === 'pending' || candidate.status === 'accepted').length, 0), [document.id, projectStatusData.batches])
  const currentProject = useMemo(() => projects.find((project) => project.id === document.projectId) ?? null, [document.projectId, projects])
  const projectOverview = useMemo(() => projects.find((project) => project.id === projectOverviewId) ?? null, [projectOverviewId, projects])
  const tasks = useMemo(() => collectTasks(taskDocuments), [taskDocuments])
  const openTaskCount = useMemo(() => tasks.filter((task) => task.status !== 'done').length, [tasks])
  const tagReferenceCount = (tagId: string) => taskDocuments.reduce((count, item) => count + Object.values(item.nodes).filter((node) => node.tagIds.includes(tagId)).length, 0)
  const toggleAssistantDock = () => setAssistantOpen((open) => {
    const next = !open
    saveAssistantDockOpen(next)
    return next
  })

  /** 这是用户从项目状态页发起的明确动作：打开 AI 并分析当前选中分支。 */
  const startDepositForSelectedBranch = () => {
    setAssistantOpen(true)
    setAssistantTab('deposit')
    saveAssistantDockOpen(true)
    setAssistantDepositRequestId((current) => current + 1)
  }

  useEffect(() => {
    const refresh = () => setTags(loadTags())
    window.addEventListener('mindtree:tags-changed', refresh)
    return () => window.removeEventListener('mindtree:tags-changed', refresh)
  }, [])

  useEffect(() => { setFocusedNodeId(null) }, [document.id])
  useEffect(() => {
    if (!selectedNodeId && assistantContextScope === 'selection') setAssistantContextScope('document')
    if (!document.projectId && assistantContextScope === 'project') setAssistantContextScope(selectedNodeId ? 'selection' : 'document')
  }, [assistantContextScope, document.projectId, selectedNodeId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !focusedNodeId) return
      if ((event.target as HTMLElement | null)?.closest('input, textarea, [role="dialog"]')) return
      event.preventDefault()
      setFocusedNodeId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedNodeId])

  useEffect(() => {
    const syncDepositHistory = (event: Event) => {
      const detail = (event as CustomEvent<{ batchId: string; applied: boolean }>).detail
      if (detail?.batchId) void setDepositBatchAppliedState(detail.batchId, detail.applied).catch(console.warn)
    }
    window.addEventListener('mindtree:deposit-history', syncDepositHistory)
    return () => window.removeEventListener('mindtree:deposit-history', syncDepositHistory)
  }, [])

  const setSelectedNodeTags = (tagIds: string[]) => {
    if (selectedNode) dispatch({ type: 'SET_NODE_TAGS', nodeId: selectedNode.id, tagIds })
  }

  const addTagToSelectedNode = () => {
    if (!selectedNode || !tagDraft.trim()) return
    const normalized = tagDraft.trim()
    const existing = tags.find((tag) => tag.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())
    const tag = existing ?? createTag(normalized)
    if (!existing) saveTags([...tags, tag])
    setSelectedNodeTags([...selectedNode.tagIds, tag.id])
    setTagDraft('')
  }

  const runExport = (operation: () => Promise<ExportFileResult>) => {
    setExportOpen(false)
    setExportStatus(null)
    void operation()
      .then((result) => setExportStatus({ message: exportFileStatus(result), path: result.path }))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setExportStatus({ message: '已取消导出。' })
          return
        }
        setExportStatus({ message: error instanceof Error ? `导出失败：${error.message}` : '导出失败，请重试。' })
      })
  }

  const exportCurrentDocument = (mode: MarkdownExportMode) => {
    runExport(() => downloadMarkdown(document, mode))
  }

  const exportCurrentOpml = () => {
    runExport(() => downloadOpml(document))
  }

  const exportCurrentSvg = (transparent = false) => {
    runExport(() => downloadDocumentSvg(document, { transparent }))
  }

  const addNodeLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedNode || !linkUrl.trim()) return
    if (dispatch({ type: 'ADD_NODE_LINK', nodeId: selectedNode.id, url: linkUrl, label: linkLabel })) {
      setLinkUrl('')
      setLinkLabel('')
    }
  }

  const addInternalNodeLink = (documentId: string, nodeId: string) => {
    if (!selectedNode) return
    if (documentId === document.id && nodeId === selectedNode.id) {
      setLinkStatus('不能把节点链接到自身。')
      setInternalLinkPickerOpen(false)
      return
    }
    const targetDocument = taskDocuments.find((item) => item.id === documentId)
    const targetNode = targetDocument?.nodes[nodeId]
    if (!targetDocument || !targetNode) {
      setLinkStatus('目标节点已不存在，未创建链接。')
      setInternalLinkPickerOpen(false)
      return
    }
    try {
      dispatch({ type: 'ADD_NODE_LINK', nodeId: selectedNode.id, url: createInternalNodeLink(documentId, nodeId), label: `${targetDocument.title} › ${targetNode.topic}` })
      setLinkStatus(`已链接到「${targetNode.topic}」`)
    } catch (error) {
      setLinkStatus(error instanceof Error ? error.message : '内部链接创建失败。')
    }
    setInternalLinkPickerOpen(false)
  }

  const followNodeLink = (url: string) => {
    const resolved = resolveInternalNodeLink(url, taskDocuments)
    if (resolved.status === 'ok') {
      setLinkStatus(null)
      revealWorkspaceNode(resolved.document.id, resolved.node.id)
      return
    }
    setLinkStatus(resolved.status === 'missing-document' ? '链接指向的导图已不存在。' : '链接指向的节点已不存在。')
  }

  const copySelectedNodeLink = async () => {
    if (!selectedNode) return
    try {
      await navigator.clipboard.writeText(createInternalNodeLink(document.id, selectedNode.id))
      setLinkStatus('已复制当前节点链接。')
    } catch {
      setLinkStatus('复制失败，请检查系统剪贴板权限。')
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
      const [attachment, imagePresentation] = await Promise.all([saveNodeAttachment(document.id, selectedNode.id, file), readImagePresentation(file)])
      if (imagePresentation) attachment.image = imagePresentation
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

  const addProject = () => {
    const name = projectNameDraft.trim()
    if (!name) return
    const project = createProject(name, projectDescriptionDraft)
    const next = [project, ...projects]
    setProjects(next)
    saveProjects(next)
    setProjectNameDraft('')
    setProjectDescriptionDraft('')
    setProjectCreateOpen(false)
  }

  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 620px)').matches) {
      setMobilePanel((current) => current === 'navigation' ? null : 'navigation')
      return
    }
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed
      localStorage.setItem('mindtree.sidebar-collapsed', String(next))
      return next
    })
  }

  const toggleInspector = () => {
    if (window.matchMedia('(max-width: 620px)').matches) {
      setMobilePanel((current) => current === 'inspector' ? null : 'inspector')
      return
    }
    setInspectorCollapsed((collapsed) => {
      const next = !collapsed
      localStorage.setItem('mindtree.inspector-collapsed', String(next))
      return next
    })
  }

  const toggleWorkspaceView = () => setWorkspaceView((current) => {
    const next = current === 'map' ? 'outline' : 'map'
    localStorage.setItem('mindtree.workspace-view', next)
    return next
  })

  /** 项目状态只读取已确认的沉淀与协作会话；刷新不会改写任何节点或原始记录。 */
  const refreshProjectStatus = useCallback(async () => {
    setProjectStatusRefreshing(true)
    try {
      const [batches, provenance, workflowSessions] = await Promise.all([listAllDepositBatches(), listAllDepositProvenance(), listAllWorkflowSessions()])
      setProjectStatusData({ batches, provenance, workflowSessions })
    } catch (error) {
      console.warn('无法刷新项目状态', error)
    } finally {
      setProjectStatusRefreshing(false)
    }
  }, [])

  useEffect(() => { void refreshProjectStatus() }, [document.id, document.updatedAt, refreshProjectStatus])

  const persistDocument = useCallback(async (documentToSave: MindMapDocument) => {
    if (deletedDocumentIdsRef.current.has(documentToSave.id)) return
    try {
      await saveDocument(documentToSave)
      await pruneStoredAttachmentsForDocument(documentToSave)
      setDocuments((current) => [documentToSave, ...current.filter((item) => item.id !== documentToSave.id)]
        .sort((left, right) => right.updatedAt - left.updatedAt))
      setPersistenceError(null)
      documentBroadcastRef.current?.postMessage({
        type: 'document-saved',
        senderId: tabIdRef.current,
        documentId: documentToSave.id,
        title: documentToSave.title,
        updatedAt: documentToSave.updatedAt,
      })
    } catch (error) {
      console.error('MindTree 本地保存失败', error)
      setPersistenceError('本地自动保存失败：请先导出导图或工作区备份；浏览器存储可能不可用或已满。')
      throw error
    }
  }, [])

  // IndexedDB 的写入不会触发 localStorage 的 storage 事件，因此跨窗口编辑使用
  // BroadcastChannel 显式通知。只提示同一份、且确实更新的导图，不自动覆盖当前编辑。
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(documentBroadcastChannelName)
    documentBroadcastRef.current = channel
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data
      if (!message || typeof message !== 'object') return
      const data = message as Partial<ExternalDocumentChange & { type: string; senderId: string }>
      if (data.type !== 'document-saved' || data.senderId === tabIdRef.current
        || typeof data.documentId !== 'string' || typeof data.title !== 'string' || typeof data.updatedAt !== 'number') return
      const active = useEditorStore.getState().document
      if (active.id !== data.documentId || data.updatedAt <= active.updatedAt) return
      setExternalDocumentChange({ documentId: data.documentId, title: data.title, updatedAt: data.updatedAt })
    }
    return () => {
      documentBroadcastRef.current = null
      channel.close()
    }
  }, [])

  const togglePinnedDocument = useCallback((target: MindMapDocument) => {
    if (target.isDraft) return
    if (target.id === useEditorStore.getState().document.id) {
      dispatch({ type: 'SET_PINNED', pinned: !target.pinned })
      return
    }
    void persistDocument({ ...target, pinned: !target.pinned, updatedAt: Date.now() }).catch(() => {
      window.alert('无法更新导图置顶状态，请重试。')
    })
  }, [dispatch, persistDocument])

  const assignDocumentToProject = useCallback((target: MindMapDocument, projectId: string | null) => {
    if (target.id === useEditorStore.getState().document.id) {
      dispatch({ type: 'SET_PROJECT', projectId })
      return
    }
    void persistDocument({ ...target, projectId, updatedAt: Date.now() }).catch(() => {
      window.alert('无法更新导图归属项目，请重试。')
    })
  }, [dispatch, persistDocument])

  const setDocumentKind = useCallback((target: MindMapDocument, kind: DocumentKind) => {
    if (target.id === useEditorStore.getState().document.id) {
      dispatch({ type: 'SET_DOCUMENT_KIND', kind })
      return
    }
    void persistDocument({ ...target, kind, updatedAt: Date.now() }).catch(() => window.alert('无法更新内容类型，请重试。'))
  }, [dispatch, persistDocument])

  const openDocumentRename = useCallback((target: MindMapDocument) => {
    if (target.isDraft) return
    setDocumentRenameTarget(target)
    setDocumentRenameDraft(target.title)
  }, [])

  const saveDocumentRename = useCallback(() => {
    const target = documentRenameTarget
    const title = documentRenameDraft.trim()
    if (!target || !title) return
    if (target.id === useEditorStore.getState().document.id) {
      dispatch({ type: 'RENAME_DOCUMENT', title })
    } else {
      void persistDocument({ ...target, title, updatedAt: Date.now() }).catch(() => window.alert('无法重命名导图，请重试。'))
    }
    setDocumentRenameTarget(null)
    setDocumentRenameDraft('')
  }, [dispatch, documentRenameDraft, documentRenameTarget, persistDocument])

  const deleteSavedDocument = useCallback(async (target: MindMapDocument) => {
    if (target.isDraft || !window.confirm(`删除导图“${target.title}”？\n\n导图、附件和历史版本将从本机永久删除。`)) return
    const deletingCurrent = target.id === useEditorStore.getState().document.id
    deletedDocumentIdsRef.current.add(target.id)
    if (deletingCurrent) {
      if (pendingSaveRef.current !== null) window.clearTimeout(pendingSaveRef.current)
      if (pendingSnapshotRef.current !== null) window.clearTimeout(pendingSnapshotRef.current)
      pendingSaveRef.current = null
      pendingSnapshotRef.current = null
    }
    try {
      await deleteLocalDocument(target.id)
    } catch (error) {
      deletedDocumentIdsRef.current.delete(target.id)
      if (deletingCurrent) await persistDocument(useEditorStore.getState().document).catch(console.warn)
      window.alert(error instanceof Error ? `删除失败：${error.message}` : '删除失败，请重试。')
      return
    }
    const remaining = documents.filter((item) => item.id !== target.id)
    setDocuments(remaining)
    if (!deletingCurrent) return
    observedVersionRef.current = null
    const next = remaining.find((item) => !isBackgroundBackup(item))
    if (next) hydrate(next)
    else createDocument()
  }, [createDocument, documents, hydrate, persistDocument])

  const openProjectRename = useCallback((project: WorkspaceProject) => {
    setProjectRenameTarget(project)
    setProjectRenameDraft(project.name)
  }, [])

  const saveProjectRename = useCallback(() => {
    const target = projectRenameTarget
    const name = projectRenameDraft.trim()
    if (!target || !name) return
    const next = projects.map((project) => project.id === target.id ? { ...project, name, updatedAt: Date.now() } : project)
    setProjects(next)
    saveProjects(next)
    setProjectRenameTarget(null)
    setProjectRenameDraft('')
  }, [projectRenameDraft, projectRenameTarget, projects])

  const updateProject = useCallback((target: WorkspaceProject, patch: Partial<WorkspaceProject>) => {
    const next = projects.map((project) => project.id === target.id ? { ...project, ...patch, id: project.id, updatedAt: Date.now() } : project)
    setProjects(next)
    saveProjects(next)
  }, [projects])

  const deleteProject = useCallback(async (target: WorkspaceProject) => {
    const count = documents.filter((item) => item.projectId === target.id).length
    if (!window.confirm(`删除项目“${target.name}”？\n\n其中 ${count} 张导图与记录会保留，并自动回到“未归属导图”。`)) return
    try {
      await persistDocument(useEditorStore.getState().document)
      const stored = await listDocuments()
      const migrated = stored.filter((item) => item.projectId === target.id).map((item) => ({ ...item, projectId: null, updatedAt: Date.now() }))
      await Promise.all(migrated.map((item) => saveDocument(item)))
      const nextProjects = projects.filter((project) => project.id !== target.id)
      setProjects(nextProjects)
      saveProjects(nextProjects)
      setDocuments((current) => current.map((item) => item.projectId === target.id ? { ...item, projectId: null, updatedAt: Date.now() } : item))
      if (useEditorStore.getState().document.projectId === target.id) dispatch({ type: 'SET_PROJECT', projectId: null })
    } catch (error) {
      window.alert(error instanceof Error ? `删除项目失败：${error.message}` : '删除项目失败，请重试。')
    }
  }, [dispatch, documents, persistDocument, projects])

  const adoptWorkspaceDocuments = useCallback((updatedDocuments: MindMapDocument[]) => {
    setDocuments((current) => [...updatedDocuments, ...current.filter((item) => !updatedDocuments.some((updated) => updated.id === item.id))]
      .sort((left, right) => right.updatedAt - left.updatedAt))
    const active = updatedDocuments.find((item) => item.id === useEditorStore.getState().document.id)
    if (active) {
      observedVersionRef.current = { documentId: active.id, updatedAt: active.updatedAt }
      hydrate(active)
    }
  }, [hydrate])

  const flushCurrentDocument = useCallback(async () => {
    if (!hydrated) return
    if (pendingSaveRef.current !== null) {
      window.clearTimeout(pendingSaveRef.current)
      pendingSaveRef.current = null
    }
    await persistDocument(useEditorStore.getState().document)
  }, [hydrated, persistDocument])

  const loadExternalDocumentChange = useCallback(async () => {
    const change = externalDocumentChange
    if (!change) return
    const current = useEditorStore.getState().document
    if (current.id !== change.documentId) {
      setExternalDocumentChange(null)
      return
    }
    try {
      // 绝不先把当前内存内容写回 documents 表：那会覆盖另一个窗口的更新。
      // 先作为独立版本保存，成功后才载入对方已落盘的版本。
      await saveDocumentVersion(createDocumentVersion(current, 'restore-point', '跨窗口更新前备份'))
      const latest = await loadDocument(change.documentId)
      if (!latest || latest.updatedAt < change.updatedAt) throw new Error('另一窗口的新版本尚未完成写入，请稍后重试。')
      observedVersionRef.current = { documentId: latest.id, updatedAt: latest.updatedAt }
      hydrate(latest)
      setDocuments((items) => [latest, ...items.filter((item) => item.id !== latest.id)]
        .sort((left, right) => right.updatedAt - left.updatedAt))
      setExternalDocumentChange(null)
      setLocalSaveStatus('已载入另一窗口的最新版本；原内容已保存到版本历史。')
    } catch (error) {
      console.error('载入另一窗口的导图失败', error)
      setPersistenceError(error instanceof Error ? `无法安全载入另一窗口版本：${error.message}` : '无法安全载入另一窗口版本，请稍后重试。')
    }
  }, [externalDocumentChange, hydrate])

  const saveCurrentToLocalFile = useCallback(async () => {
    // 必须在快捷键/点击的同步用户手势中立即打开选择框；若先 await IndexedDB，
    // Chromium 会认为用户手势已经失效并拒绝 showSaveFilePicker。
    const snapshot = useEditorStore.getState().document
    const localFileSave = saveDocumentToLocalFile(snapshot)
    try {
      await flushCurrentDocument()
      const result = await localFileSave
      setLocalSaveStatus(result === 'download' ? '已写入本地数据库，浏览器已开始下载导图文件。' : '已保存到所选本机位置，并写入本地数据库。')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setLocalSaveStatus('已取消本机文件保存；本地数据库仍已保存。')
        return
      }
      setLocalSaveStatus('本机文件保存失败，但本地数据库已保留当前内容。')
    }
  }, [flushCurrentDocument])

  /** 将已通过 schema 校验的导图写入工作区；覆盖同 ID 文档时先留下可恢复快照。 */
  const completeDocumentImport = useCallback(async (source: MindMapDocument, mode: 'replace' | 'copy') => {
    try {
      setImportBusy(true)
      setImportStatus(null)
      await flushCurrentDocument()
      const existing = documents.find((item) => item.id === source.id)
      if (mode === 'replace' && existing) {
        await saveDocumentVersion(createDocumentVersion(existing, 'manual', '导入前备份'))
      }
      const now = Date.now()
      const next = mode === 'copy'
        ? createImportedCopy(source, now)
        : { ...structuredClone(source), updatedAt: now }
      // 导出文件不携带远端版本；清除旧元数据后，下一次同步会先走保守冲突检查。
      await deleteSyncMetadata(next.id)
      await persistDocument(next)
      await saveDocumentVersion(createDocumentVersion(next, 'manual', '导入的导图'))
      observedVersionRef.current = { documentId: next.id, updatedAt: next.updatedAt }
      setSyncRemoteVersion(null)
      hydrate(next)
      setImportCandidate(null)
      setImportStatus(mode === 'copy' ? `已导入副本「${next.title}」` : `已导入「${next.title}」`)
    } catch (error) {
      setImportStatus(error instanceof Error ? `导入失败：${error.message}` : '导入失败，请重试。')
    } finally {
      setImportBusy(false)
    }
  }, [documents, flushCurrentDocument, hydrate, persistDocument])

  const importDocumentFromFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('导入文件不能超过 2 MB')
      const content = await file.text()
      const lowerName = file.name.toLowerCase()
      if (lowerName.endsWith('.opml') || lowerName.endsWith('.xml')) {
        setUniversalImportCandidate({ ...parseOpml(content, file.name), format: 'OPML' })
        setImportStatus(null)
        return
      }
      if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
        setUniversalImportCandidate({ ...parseMarkdownOutline(content, file.name), format: 'Markdown' })
        setImportStatus(null)
        return
      }
      const imported = parseDocumentFile(content)
      if (documents.some((item) => item.id === imported.id)) {
        setImportCandidate(imported)
        setImportStatus(null)
        return
      }
      await completeDocumentImport(imported, 'replace')
    } catch (error) {
      setImportStatus(error instanceof Error ? `无法导入：${error.message}` : '无法读取导图文件。')
    }
  }, [completeDocumentImport, documents])

  const exportWorkspaceBackup = useCallback(async () => {
    try {
      setWorkspaceBackupStatus(null)
      await flushCurrentDocument()
      const workspaceDocuments = await listDocuments()
      const referencedAttachmentIds = new Set(workspaceDocuments.flatMap((item) => Object.values(item.nodes).flatMap((node) => node.attachments.map((attachment) => attachment.id))))
      const [versions, storedAttachments, depositBatches, depositProvenance, workflowSessions] = await Promise.all([listAllDocumentVersions(), listStoredAttachments(), listAllDepositBatches(), listAllDepositProvenance(), listAllWorkflowSessions()])
      const result = await saveWorkspaceBackupToLocalFile({
        documents: workspaceDocuments,
        versions,
        attachments: storedAttachments.filter((attachment) => referencedAttachmentIds.has(attachment.id)),
        categories,
        projects,
        tags,
        depositBatches,
        depositProvenance,
        workflowSessions,
      })
      setWorkspaceBackupStatus(result === 'download' ? '工作区备份已下载。' : '工作区备份已保存到本机。')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setWorkspaceBackupStatus(error instanceof Error ? `备份失败：${error.message}` : '备份失败，请重试。')
    }
  }, [categories, flushCurrentDocument, projects, tags])

  const selectWorkspaceBackupFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      setWorkspaceBackupStatus(null)
      setWorkspaceBackupCandidate(await parseWorkspaceBackup(file))
    } catch (error) {
      setWorkspaceBackupStatus(error instanceof Error ? `无法恢复：${error.message}` : '无法读取工作区备份。')
    }
  }, [])

  const confirmWorkspaceRestore = useCallback(async () => {
    if (!workspaceBackupCandidate) return
    try {
      setWorkspaceBackupBusy(true)
      setWorkspaceBackupStatus(null)
      await flushCurrentDocument()
      const attachments = await listStoredAttachments()
      const plan = prepareWorkspaceRestore(workspaceBackupCandidate, {
        documents,
        attachmentIds: new Set(attachments.map((attachment) => attachment.id)),
        categories,
        projects,
        tags,
      })
      await restoreWorkspaceData(plan)
      saveCategories(plan.categories)
      saveProjects(plan.projects ?? [])
      saveTags(plan.tags)
      setCategories(plan.categories)
      setProjects(plan.projects ?? [])
      setTags(plan.tags)
      const allDocuments = await listDocuments()
      setDocuments(allDocuments)
      const opened = plan.documents[0]
      if (opened) {
        observedVersionRef.current = { documentId: opened.id, updatedAt: opened.updatedAt }
        hydrate(opened)
        setSyncRemoteVersion(null)
      }
      setWorkspaceBackupCandidate(null)
      setWorkspaceBackupStatus(`已恢复 ${plan.documents.length} 份导图、${plan.attachments.length} 个附件、${plan.depositBatches.length} 批沉淀记录和 ${plan.workflowSessions.length} 次协作会话${plan.copiedDocumentCount ? `；其中 ${plan.copiedDocumentCount} 份已作为恢复副本保留。` : '。'}`)
    } catch (error) {
      setWorkspaceBackupStatus(error instanceof Error ? `恢复失败：${error.message}` : '恢复失败，请重试。')
    } finally {
      setWorkspaceBackupBusy(false)
    }
  }, [categories, documents, flushCurrentDocument, hydrate, projects, tags, workspaceBackupCandidate])

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
      if (navigation.projectId) dispatch({ type: 'SET_PROJECT', projectId: navigation.projectId })
      dispatch({ type: 'SET_DOCUMENT_KIND', kind: navigation.documentKind })
    }
    if (navigation.kind === 'quick-note') {
      createQuickNote()
    }
  }, [createDocument, createQuickNote, dispatch, flushCurrentDocument, hydrate])

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

  const startNewDocument = useCallback((projectId: string | null = null, documentKind: DocumentKind = 'map') => requestNavigation({ kind: 'new-map', projectId, documentKind }), [requestNavigation])
  const startQuickNote = useCallback(() => requestNavigation({ kind: 'quick-note' }), [requestNavigation])

  const deleteQuickNote = useCallback(async (draft: MindMapDocument, navigationAfterDelete: PendingNavigation | null = null) => {
    if (!draft.isDraft || !window.confirm(`删除随手记“${draft.title}”？\n\n正文、附件和历史版本将从本机永久删除。`)) return
    const deletingCurrent = draft.id === useEditorStore.getState().document.id
    deletedDocumentIdsRef.current.add(draft.id)
    if (deletingCurrent) {
      if (pendingSaveRef.current !== null) window.clearTimeout(pendingSaveRef.current)
      if (pendingSnapshotRef.current !== null) window.clearTimeout(pendingSnapshotRef.current)
      pendingSaveRef.current = null
      pendingSnapshotRef.current = null
    }
    try {
      await deleteLocalDocument(draft.id)
    } catch (error) {
      deletedDocumentIdsRef.current.delete(draft.id)
      if (deletingCurrent) await persistDocument(useEditorStore.getState().document).catch(console.warn)
      window.alert(error instanceof Error ? `删除失败：${error.message}` : '删除失败，请重试。')
      return
    }
    const remaining = documents.filter((item) => item.id !== draft.id)
    setDocuments(remaining)
    if (!deletingCurrent) return
    setDraftSaveOpen(false)
    setPendingNavigation(null)
    observedVersionRef.current = null
    if (navigationAfterDelete) {
      await runNavigation(navigationAfterDelete).catch((error) => window.alert(error instanceof Error ? error.message : '切换失败，请重试。'))
      return
    }
    const next = remaining.find((item) => !isBackgroundBackup(item))
    if (next) hydrate(next)
    else createDocument()
  }, [createDocument, documents, hydrate, persistDocument, runNavigation])

  const openTask = useCallback((task: MindTreeTask) => {
    setTaskCenterOpen(false)
    if (task.documentId === document.id) {
      if (dispatch({ type: 'REVEAL_NODE', nodeId: task.nodeId })) requestNodeFocus(task.nodeId)
      return
    }
    const target = taskDocuments.find((item) => item.id === task.documentId)
    if (!target) return
    pendingNodeFocusRef.current = { documentId: task.documentId, nodeId: task.nodeId }
    openDocument(target)
  }, [dispatch, document.id, openDocument, requestNodeFocus, taskDocuments])

  const revealWorkspaceNode = useCallback((documentId: string, nodeId: string) => {
    setFocusedNodeId(null)
    if (documentId === document.id) {
      if (dispatch({ type: 'REVEAL_NODE', nodeId })) requestNodeFocus(nodeId)
      return
    }
    const target = taskDocuments.find((item) => item.id === documentId)
    if (!target) return
    pendingNodeFocusRef.current = { documentId, nodeId }
    openDocument(target)
  }, [dispatch, document.id, openDocument, requestNodeFocus, taskDocuments])

  const revealWorkspaceSearchResult = useCallback((documentId: string, nodeId: string) => {
    revealWorkspaceNode(documentId, nodeId)
    setWorkspaceSearchOpen(false)
  }, [revealWorkspaceNode])

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

  const updateTaskPriority = useCallback(async (task: MindTreeTask, priority: 0 | 1 | 2 | 3) => {
    const target = taskDocuments.find((item) => item.id === task.documentId)
    if (!target) return
    if (target.id === document.id) { dispatch({ type: 'SET_NODE_PRIORITY', nodeId: task.nodeId, priority }); return }
    try { await persistDocument(executeCommand(target, { type: 'SET_NODE_PRIORITY', nodeId: task.nodeId, priority }).document) } catch (error) { console.warn(error) }
  }, [dispatch, document.id, persistDocument, taskDocuments])

  const updateTaskDueDate = useCallback(async (task: MindTreeTask, dueDate: string | null) => {
    const target = taskDocuments.find((item) => item.id === task.documentId)
    if (!target) return
    if (target.id === document.id) { dispatch({ type: 'SET_NODE_DUE_DATE', nodeId: task.nodeId, dueDate }); return }
    try { await persistDocument(executeCommand(target, { type: 'SET_NODE_DUE_DATE', nodeId: task.nodeId, dueDate }).document) } catch (error) { console.warn(error) }
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

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void saveCurrentToLocalFile()
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [saveCurrentToLocalFile])

  const saveSyncSettings = useCallback((nextConfig: SyncConfig) => {
    saveSyncConfig(nextConfig)
    setSyncConfig(nextConfig)
    setSyncStatus('连接设置已保存在此浏览器。')
  }, [])

  const syncAccountLibrary = useCallback(async (config: SyncConfig) => {
    const accountId = accountSession?.user.id
    if (!accountId) return
    setSyncStatus('正在同步账号导图库…')
    const activeDocument = useEditorStore.getState().document
    const result = await synchronizeAccountLibrary(config, {
      listLocalDocuments: listDocuments,
      listRemoteDocuments: fetchRemoteDocuments,
      loadMetadata: getSyncMetadata,
      saveLocalDocument: saveDocument,
      saveMetadata: saveSyncMetadata,
      pushLocalDocument: pushDocument,
    }, accountId)
    setDocuments(result.documents)
    if (result.preferredDocument && isUntouchedStarterDocument(activeDocument)) hydrate(result.preferredDocument)
    const completed = [
      result.imported ? `拉取 ${result.imported} 份` : '',
      result.updated ? `更新 ${result.updated} 份` : '',
      result.uploaded ? `上传 ${result.uploaded} 份` : '',
      result.protected ? `隔离保护 ${result.protected} 份其他账号资料` : '',
    ].filter(Boolean).join('，')
    setSyncStatus(result.conflicts
      ? `${completed || '导图库已检查'}；${result.conflicts} 份存在两端修改，已保留本地版本。`
      : completed ? `账号导图库同步完成：${completed}。` : '账号导图库已是最新状态。')
  }, [accountSession?.user.id, hydrate])

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
      if (accountSession && metadata && metadata.accountId !== accountSession.user.id) {
        setSyncStatus('这份导图属于其他账号或旧版归属不明，已阻止上传。请先导出副本，再决定是否导入当前账号。')
        return
      }
      const result = await pushDocument(config, document, metadata?.remoteVersion ?? 0)
      if (result.type === 'conflict') {
        setSyncConflict(result.remote)
        setSyncStatus('云端已有较新的版本，本地内容未被上传。')
        return
      }
      await saveSyncMetadata({ documentId: document.id, remoteVersion: result.remote.version, syncedAt: Date.now(), accountId: accountSession?.user.id })
      setSyncRemoteVersion(result.remote.version)
      setSyncStatus(`已上传到云端 · v${result.remote.version}`)
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : '上传失败，请检查服务地址与 Token。')
    } finally {
      setSyncBusy(false)
    }
  }, [accountSession, document, flushCurrentDocument, saveSyncSettings])

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
    await saveSyncMetadata({ documentId: remote.payload.id, remoteVersion: remote.version, syncedAt: now, accountId: accountSession?.user.id })
    setDocuments((current) => [remote.payload, ...current.filter((item) => item.id !== remote.payload.id)]
      .sort((left, right) => right.updatedAt - left.updatedAt))
    hydrate(remote.payload)
    setSyncRemoteVersion(remote.version)
  }, [accountSession?.user.id, hydrate])

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
      if (accountSession && metadata && metadata.accountId !== accountSession.user.id) return
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
  }, [accountSession, pullRemoteDocument])

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
    const pending = pendingNodeFocusRef.current
    if (!pending || pending.documentId !== document.id) return
    pendingNodeFocusRef.current = null
    if (dispatch({ type: 'REVEAL_NODE', nodeId: pending.nodeId })) requestNodeFocus(pending.nodeId)
  }, [dispatch, document.id, requestNodeFocus])

  // 自动同步触发：每次打开应用或切换文档后，静默拉取云端较新版本。
  useEffect(() => {
    if (!hydrated) return
    const config = loadSyncConfig()
    if (!config.token.trim()) return
    void autoSync(config)
  }, [document.id, hydrated, autoSync])

  // 同一账号在新设备登录后，先发现并导入整个云端导图库；账号云端为空时则上传现有本地导图。
  useEffect(() => {
    if (!hydrated || !accountSession) return
    const config = loadSyncConfig()
    if (!config.token.trim()) return
    const syncKey = `${config.serverUrl}\u0000${accountSession.user.id}\u0000${config.token}`
    if (accountLibrarySyncKeyRef.current === syncKey) return
    accountLibrarySyncKeyRef.current = syncKey
    void syncAccountLibrary(config).catch((error) => {
      accountLibrarySyncKeyRef.current = null
      setSyncStatus(error instanceof Error ? `账号导图库同步失败：${error.message}` : '账号导图库同步失败。')
    })
  }, [accountSession, hydrated, syncAccountLibrary])

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${inspectorCollapsed ? 'is-inspector-collapsed' : ''} ${assistantOpen ? 'is-assistant-open' : ''} ${mobilePanel === 'navigation' ? 'is-mobile-navigation-open' : ''} ${mobilePanel === 'inspector' ? 'is-mobile-inspector-open' : ''}`} style={{
      '--app-bg': theme.canvas,
      '--chrome-bg': theme.chrome,
      '--panel-bg': theme.surface,
      '--app-text': theme.nodeText,
      '--muted-text': theme.id === 'cyber' || theme.id === 'midnight' ? '#aab4c8' : '#898a80',
      '--line': theme.nodeBorder,
      '--accent': theme.selected,
      '--assistant-dock-width': `${assistantDockWidth}px`,
    } as CSSProperties}>
      <input ref={importInputRef} className="document-import-input" type="file" accept=".mindtree.json,.json,.opml,.xml,.md,.markdown,application/json,text/x-opml,text/xml,text/markdown" onChange={(event) => { void importDocumentFromFile(event) }} aria-hidden="true" tabIndex={-1} />
      <input ref={workspaceBackupInputRef} className="document-import-input" type="file" accept=".mindtree-backup.zip,.zip,application/zip" onChange={(event) => { void selectWorkspaceBackupFile(event) }} aria-hidden="true" tabIndex={-1} />
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">M</span>
          <span>MindTree</span>
        </div>
        <div className="document-title">
          <input value={document.title} aria-label="导图标题" onChange={(event) => dispatch({ type: 'RENAME_DOCUMENT', title: event.target.value })} />
          <span className="save-state">{hydrated ? document.isDraft ? '随手记草稿 · 已本机保存' : '已本地保存' : '正在打开…'}</span>
        </div>
        <nav className="floating-toolbar" aria-label="导图编辑工具">
          <div className="floating-toolbar__cluster">
            <button className="floating-toolbar__icon" onClick={undo} disabled={!past.length} title="撤销 (⌘Z)" aria-label="撤销"><Icon><RotateCounterClockwiseIcon /></Icon></button>
            <button className="floating-toolbar__icon floating-toolbar__icon--redo" onClick={redo} disabled={!future.length} title="重做 (⇧⌘Z)" aria-label="重做"><Icon><RotateCounterClockwiseIcon /></Icon></button>
          </div>
          <span className="floating-toolbar__divider" />
          <div className="floating-toolbar__cluster">
            <button className="floating-toolbar__button" disabled={selectedNode?.isFreeTopic} onClick={() => dispatch({ type: 'ADD_CHILD', parentId: selectedNodeId ?? document.rootId })} title={selectedNode?.isFreeTopic ? '自由主题请先附加到主节点' : '新建子节点 (Tab)'}><Icon><PlusIcon /></Icon><span>子节点</span></button>
            <button className="floating-toolbar__button" disabled={(selectedNodeId ?? document.rootId) === document.rootId || selectedNodeId === focusedNodeId || selectedNode?.isFreeTopic} onClick={() => dispatch({ type: 'ADD_SIBLING', nodeId: selectedNodeId ?? document.rootId })} title={selectedNodeId === focusedNodeId ? '聚焦根节点请创建子节点，避免新节点出现在聚焦范围外' : selectedNode?.isFreeTopic ? '自由主题不能创建同级节点' : '新建同级节点 (Enter)'}><Icon><EnterIcon /></Icon><span>同级</span></button>
            <button
              className="floating-toolbar__button"
              disabled={!selectedNodeIds.length}
              onClick={() => requestRelatedTopic(selectedNodeIds)}
              title={selectedNodeIds.length > 1 ? `${selectedNodeIds.length} 个节点的关系线将跟随鼠标` : selectedNode ? '关系线跟随鼠标；单击已有节点或双击空白处' : '先选中一个节点'}
            ><Icon><Link2Icon /></Icon><span>{selectedNodeIds.length > 1 ? '共同联系' : '建立联系'}</span></button>
            <button className="floating-toolbar__icon" disabled={!canGroupSelection} onClick={() => dispatch({ type: 'CREATE_SUMMARY', nodeIds: selectedNodeIds })} title={canGroupSelection ? '为所选同级节点创建摘要' : '先选择两个或以上同级节点'} aria-label="创建摘要"><Icon><SummaryIcon /></Icon></button>
            <button className="floating-toolbar__icon" disabled={!canGroupSelection} onClick={() => dispatch({ type: 'CREATE_BOUNDARY', nodeIds: selectedNodeIds })} title={canGroupSelection ? '为所选同级节点创建边界' : '先选择两个或以上同级节点'} aria-label="创建边界"><Icon><BoundaryIcon /></Icon></button>
            <button className="floating-toolbar__button" disabled={Boolean(focusedNodeId)} onClick={() => dispatch({ type: 'AUTO_ARRANGE' })} title={focusedNodeId ? '退出聚焦后再排列完整导图' : '自动排列并保留当前自由排布'}><Icon><ReloadIcon /></Icon><span>排列</span></button>
            <button className={`floating-toolbar__button ${focusedNodeId ? 'is-active' : ''}`} disabled={!selectedNode || selectedNode.id === document.rootId || selectedNode.isFreeTopic} onClick={() => selectedNode && setFocusedNodeId((current) => current === selectedNode.id ? null : selectedNode.id)} title={focusedNodeId === selectedNode?.id ? '退出当前分支聚焦 (Esc)' : '只显示所选节点及其后代'}><Icon><TargetIcon /></Icon><span>{focusedNodeId === selectedNode?.id ? '退出聚焦' : '聚焦'}</span></button>
          </div>
        </nav>
        <div className="topbar-utility">
          <button className="topbar-utility__button desktop-search-trigger" type="button" onClick={() => setWorkspaceSearchOpen(true)} title="搜索工作区节点" aria-label="搜索工作区节点"><Icon><MagnifyingGlassIcon /></Icon><span>搜索</span><kbd>⌘ K</kbd></button>
          <span className="export-menu-wrap desktop-filter-control"><button className={`topbar-utility__button ${hasActiveFilter(nodeFilter) ? 'is-active' : ''}`} onClick={() => setFilterOpen((open) => !open)} title="按标签、标记与任务属性高亮" aria-label="筛选和高亮"><Icon><MixerHorizontalIcon /></Icon></button>{filterOpen && <span className="filter-menu"><header><strong>筛选高亮</strong>{hasActiveFilter(nodeFilter) && <button onClick={clearNodeFilter}>清除</button>}</header><p>匹配节点保持清晰，其余节点淡化，不改变布局。</p>{tags.length > 0 && <section><label>标签</label><div>{tags.map((tag) => <button key={tag.id} className={nodeFilter.tags.includes(tag.id) ? 'is-selected' : ''} onClick={() => setNodeFilter({ ...nodeFilter, tags: toggleValue(nodeFilter.tags, tag.id) })}><i style={{ background: tag.color }} />{tag.name}</button>)}</div></section>}<section><label>标记</label><div>{nodeMarkOrder.map((mark) => <button key={mark} className={nodeFilter.marks.includes(mark) ? 'is-selected' : ''} onClick={() => setNodeFilter({ ...nodeFilter, marks: toggleValue(nodeFilter.marks, mark) })}>{nodeMarkMeta[mark].icon} {nodeMarkMeta[mark].label}</button>)}</div></section><section><label>任务</label><div>{([['todo', '待办'], ['doing', '进行中'], ['done', '已完成']] as const).map(([status, label]) => <button key={status} className={nodeFilter.statuses.includes(status) ? 'is-selected' : ''} onClick={() => setNodeFilter({ ...nodeFilter, statuses: toggleValue(nodeFilter.statuses, status) })}>{label}</button>)}</div></section><section><label>优先级</label><div>{([1, 2, 3] as const).map((priority) => <button key={priority} className={nodeFilter.priorities.includes(priority) ? 'is-selected' : ''} onClick={() => setNodeFilter({ ...nodeFilter, priorities: toggleValue(nodeFilter.priorities, priority) })}>P{priority}</button>)}</div></section></span>}</span>
          <AssistantDockToggleButton open={assistantOpen} hasNudge={hasDepositNudge} onToggle={toggleAssistantDock} />
          <DesktopUtilityMenu
            viewIsOutline={workspaceView === 'outline'}
            sidebarCollapsed={sidebarCollapsed}
            inspectorCollapsed={inspectorCollapsed}
            signedIn={Boolean(accountSession)}
            isDraft={document.isDraft}
            onToggleView={toggleWorkspaceView}
            onSaveFile={() => { void saveCurrentToLocalFile() }}
            onOpenHistory={() => setHistoryOpen(true)}
            onStartPresentation={() => setPresentationStartNodeId(selectedNodeId ?? focusedNodeId ?? document.rootId)}
            onExportSvg={exportCurrentSvg}
            onExportOpml={exportCurrentOpml}
            onExportMarkdown={exportCurrentDocument}
            onExportWorkspaceBackup={() => { void exportWorkspaceBackup() }}
            onToggleSidebar={toggleSidebar}
            onToggleInspector={toggleInspector}
            onLogin={() => setLoginOpen(true)}
            onSync={() => setSyncOpen(true)}
            onDeleteDraft={() => { void deleteQuickNote(document) }}
            onSaveDraft={() => { setDraftTitle(document.title); setDraftCategoryId(document.categoryId); setPendingNavigation(null); setDraftSaveOpen(true) }}
          />
          <button className="topbar-utility__button topbar-mobile-action" onClick={toggleSidebar} title="打开导图与项目" aria-label="打开导图与项目" aria-expanded={mobilePanel === 'navigation'}><Icon><HamburgerMenuIcon /></Icon></button>
          <button className="topbar-utility__button topbar-mobile-action" disabled={selectedNode?.isFreeTopic} onClick={() => dispatch({ type: 'ADD_CHILD', parentId: selectedNodeId ?? document.rootId })} title={selectedNode?.isFreeTopic ? '自由主题请先附加到主节点' : '新建子节点'} aria-label="新建子节点"><Icon><PlusIcon /></Icon></button>
          <button className="topbar-utility__button topbar-mobile-action" onClick={toggleInspector} title="打开节点属性" aria-label="打开节点属性" aria-expanded={mobilePanel === 'inspector'}><Icon><MixerVerticalIcon /></Icon></button>
          <MobileMoreMenu
            canUndo={Boolean(past.length)}
            canRedo={Boolean(future.length)}
            canAddSibling={(selectedNodeId ?? document.rootId) !== document.rootId && selectedNodeId !== focusedNodeId && !selectedNode?.isFreeTopic}
            canCreateRelation={Boolean(selectedNodeIds.length)}
            canGroupSelection={canGroupSelection}
            canArrange={!focusedNodeId}
            canFocus={Boolean(selectedNode && selectedNode.id !== document.rootId && !selectedNode.isFreeTopic)}
            focusActive={Boolean(focusedNodeId)}
            relationLabel={selectedNodeIds.length > 1 ? '共同联系' : '建立联系'}
            viewIsOutline={workspaceView === 'outline'}
            tags={tags}
            filter={nodeFilter}
            signedIn={Boolean(accountSession)}
            isDraft={document.isDraft}
            themeStyle={{
              '--panel-bg': theme.surface,
              '--app-text': theme.nodeText,
              '--muted-text': theme.id === 'cyber' || theme.id === 'midnight' ? '#aab4c8' : '#898a80',
              '--line': theme.nodeBorder,
              '--accent': theme.selected,
            } as CSSProperties}
            onUndo={undo}
            onRedo={redo}
            onAddSibling={() => dispatch({ type: 'ADD_SIBLING', nodeId: selectedNodeId ?? document.rootId })}
            onCreateRelation={() => requestRelatedTopic(selectedNodeIds)}
            onCreateSummary={() => dispatch({ type: 'CREATE_SUMMARY', nodeIds: selectedNodeIds })}
            onCreateBoundary={() => dispatch({ type: 'CREATE_BOUNDARY', nodeIds: selectedNodeIds })}
            onArrange={() => dispatch({ type: 'AUTO_ARRANGE' })}
            onToggleFocus={() => selectedNode && setFocusedNodeId((current) => current === selectedNode.id ? null : selectedNode.id)}
            onToggleView={toggleWorkspaceView}
            onSaveFile={() => { void saveCurrentToLocalFile() }}
            onOpenHistory={() => setHistoryOpen(true)}
            onStartPresentation={() => setPresentationStartNodeId(selectedNodeId ?? focusedNodeId ?? document.rootId)}
            onFilterChange={setNodeFilter}
            onClearFilter={clearNodeFilter}
            onExportSvg={exportCurrentSvg}
            onExportOpml={exportCurrentOpml}
            onExportMarkdown={exportCurrentDocument}
            onExportWorkspaceBackup={() => { void exportWorkspaceBackup() }}
            onLogin={() => setLoginOpen(true)}
            onSync={() => setSyncOpen(true)}
            onDeleteDraft={() => { void deleteQuickNote(document) }}
            onSaveDraft={() => { setDraftTitle(document.title); setDraftCategoryId(document.categoryId); setPendingNavigation(null); setDraftSaveOpen(true) }}
          />
        </div>
      </header>

      {mobilePanel && <button className="mobile-panel-scrim" aria-label="关闭侧栏" onClick={() => setMobilePanel(null)} />}

      <section className="workspace">
        <aside className="left-rail">
          <div className="sidebar-scroll">
            <div className="sidebar-workspace-name"><span className="sidebar-workspace-mark">M</span><strong>我的工作区</strong></div>
            <div className="sidebar-quick-actions"><button onClick={() => { void startQuickNote() }} title="随手记 (⌘⇧N)"><span><LightningBoltIcon /></span>随手记</button><button onClick={() => { void startNewDocument() }} title="新建导图"><span><PlusIcon /></span>新建导图</button></div>
            <WorkspaceNavigator
              projects={projects}
              documents={taskDocuments}
              activeDocumentId={document.id}
              pendingDepositDocumentIds={pendingDepositDocumentIds}
              query={documentQuery}
              onQueryChange={setDocumentQuery}
              onOpenDocument={openDocument}
              onOpenProjectOverview={(project) => setProjectOverviewId(project.id)}
              onAssignProject={assignDocumentToProject}
              onSetDocumentKind={setDocumentKind}
              onTogglePinned={togglePinnedDocument}
              onRenameDocument={openDocumentRename}
              onDeleteDocument={(item) => { void deleteSavedDocument(item) }}
              onDeleteDraft={(item) => { void deleteQuickNote(item) }}
              onCreateProject={() => setProjectCreateOpen(true)}
              openTaskCount={openTaskCount}
              onOpenTaskCenter={() => setTaskCenterOpen(true)}
              onRenameProject={openProjectRename}
              onUpdateProject={updateProject}
              onDeleteProject={(project) => { void deleteProject(project) }}
              onCreateDocument={(projectId, kind) => { void startNewDocument(projectId, kind) }}
              onImport={() => importInputRef.current?.click()}
              onRestore={() => workspaceBackupInputRef.current?.click()}
            />

            <details className="sidebar-current-organize">
              <summary>整理当前{document.isDraft ? '记录' : '导图'}</summary>
              <label>归属项目<select value={document.projectId ?? ''} onChange={(event) => dispatch({ type: 'SET_PROJECT', projectId: event.target.value || null })}><option value="">未归属</option>{projects.filter((project) => project.status === 'active' || project.status === 'paused').map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label>内容类型<select value={document.kind} onChange={(event) => dispatch({ type: 'SET_DOCUMENT_KIND', kind: event.target.value as DocumentKind })}>{documentKinds.map((kind) => <option key={kind} value={kind}>{documentKindLabels[kind]}</option>)}</select></label>
              <label>分类<select value={document.categoryId} onChange={(event) => dispatch({ type: 'SET_CATEGORY', categoryId: event.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            </details>
          </div>
          <footer className="sidebar-footer">
            <button className="sidebar-footer-action" type="button"><span><GearIcon /></span>设置</button>
            <button className="sidebar-footer-action" type="button"><span><QuestionMarkCircledIcon /></span>帮助与反馈</button>
            <div className="sidebar-account">
              <button className="sidebar-account__trigger" onClick={() => setAccountMenuOpen((open) => !open)}><span className="sidebar-avatar">{accountSession?.user.email.slice(0, 1).toUpperCase() ?? 'M'}</span><span><strong>{accountSession?.user.email ?? '本地工作区'}</strong><small>{accountSession ? '已登录 · 可同步' : '未登录 · 本地保存'}</small></span><i>⋮</i></button>
              {accountMenuOpen && <div className="sidebar-account__menu"><strong>{accountSession ? '已登录账号' : '同步账号'}</strong><p>{accountSession ? '此账号的同步数据与其他账号隔离。' : '登录后可使用账号会话安全同步导图。'}</p>{accountSession ? <button onClick={() => { void logoutAccount() }}>退出登录</button> : <button onClick={() => { setLoginOpen(true); setAccountMenuOpen(false) }}>登录 / 注册</button>}</div>}
            </div>
          </footer>
        </aside>

        <section className="workspace-center">
          <nav className={`focus-bar ${focusedNodeId ? '' : 'is-hidden'}`} aria-label="聚焦路径">
            <span>聚焦</span>
            {focusBreadcrumb.map((item, index) => <button key={item.nodeId} disabled={index === focusBreadcrumb.length - 1} onClick={() => index === 0 ? setFocusedNodeId(null) : setFocusedNodeId(item.nodeId)}>{item.topic || '未命名主题'}</button>)}
            <button className="focus-bar__exit" onClick={() => setFocusedNodeId(null)}>显示完整导图 <kbd>Esc</kbd></button>
          </nav>
          <div className="workspace-center__view">
            {workspaceView === 'map'
              ? <MindMapCanvas workspaceDocuments={taskDocuments} onRevealWorkspaceNode={revealWorkspaceNode} focusRootId={focusedNodeId} onChangeFocusRoot={setFocusedNodeId} />
              : <OutlineView tags={tags} workspaceDocuments={taskDocuments} onRevealWorkspaceNode={revealWorkspaceNode} focusRootId={focusedNodeId} />}
          </div>
        </section>

        {assistantOpen && <AssistantDock width={assistantDockWidth} onWidthChange={setAssistantDockWidth} onWidthCommit={saveAssistantDockWidth} onClose={toggleAssistantDock} title="MindTree Agent" subtitle={currentProject ? `${currentProject.name} · ${document.title}` : document.title} activeTab={assistantTab} onTabChange={setAssistantTab} contextScope={assistantContextScope} onContextScopeChange={setAssistantContextScope} hasSelection={Boolean(selectedNodeId)} hasProject={Boolean(currentProject)} pendingCount={currentPendingDepositCount}>
          <AiAssistant heading={assistantTab === 'chat' ? '当前协作' : assistantTab === 'deposit' ? '待沉淀' : '历史记录'} document={document} targetNodeId={selectedNodeId ?? document.rootId} workspaceDocuments={taskDocuments} onBeforeWorkspaceApply={flushCurrentDocument} onWorkspaceDocumentsChanged={adoptWorkspaceDocuments} onOpenDeposit={() => setAssistantTab('deposit')} depositRequestId={assistantDepositRequestId} activeTab={assistantTab} contextScope={assistantContextScope} />
        </AssistantDock>}

        <aside className="inspector">
          <header className="inspector__header">
            <p className="eyebrow">{selectedRelation ? '关系属性' : selectedNode ? '节点属性' : '文档设置'}</p>
            {selectedNode && <nav className="inspector-tabs" aria-label="节点属性分类">
              <button className={inspectorTab === 'content' ? 'is-active' : ''} onClick={() => setInspectorTab('content')}>内容</button>
              <button className={inspectorTab === 'tasks' ? 'is-active' : ''} onClick={() => setInspectorTab('tasks')}>任务</button>
              <button className={inspectorTab === 'resources' ? 'is-active' : ''} onClick={() => setInspectorTab('resources')}>资源</button>
              <button className={inspectorTab === 'project' ? 'is-active' : ''} onClick={() => setInspectorTab('project')}>项目</button>
              <button className={inspectorTab === 'map' ? 'is-active' : ''} onClick={() => setInspectorTab('map')}>图谱</button>
            </nav>}
          </header>
          <div className="inspector__body">
            {selectedRelation ? <>
              <label className="field-label" htmlFor="relation-label">关系说明</label>
              <textarea id="relation-label" value={selectedRelation.label} rows={2} onChange={(event) => dispatch({ type: 'UPDATE_RELATION_LABEL', relationId: selectedRelation.id, label: event.target.value })} />
              <div className="property-row"><span>起点</span><strong>{document.nodes[selectedRelation.sourceId]?.topic ?? '已删除节点'}</strong></div>
              <label className="field-label" htmlFor="relation-target">指向节点</label>
              <select id="relation-target" className="relation-target-select" value={selectedRelation.targetId} onChange={(event) => dispatch({ type: 'RETARGET_RELATION', relationId: selectedRelation.id, targetId: event.target.value })}>
                {Object.values(document.nodes).filter((node) => node.id !== selectedRelation.sourceId).map((node) => <option key={node.id} value={node.id}>{node.topic || '未命名节点'}{node.isFreeTopic ? ' · 自由主题' : ''}</option>)}
              </select>
              <div className="relation-style-controls">
                <label>线条<select value={selectedRelation.lineStyle} onChange={(event) => dispatch({ type: 'UPDATE_RELATION_STYLE', relationId: selectedRelation.id, patch: { lineStyle: event.target.value as typeof selectedRelation.lineStyle } })}><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
                <label>颜色<input type="color" value={selectedRelation.color ?? theme.branch} onChange={(event) => dispatch({ type: 'UPDATE_RELATION_STYLE', relationId: selectedRelation.id, patch: { color: event.target.value } })} /></label>
              </div>
              <div className="relation-style-actions">
                <button className="subtle-button" disabled={selectedRelation.controlOffsetX === 0 && selectedRelation.controlOffsetY === 0} onClick={() => dispatch({ type: 'UPDATE_RELATION_STYLE', relationId: selectedRelation.id, patch: { controlOffsetX: 0, controlOffsetY: 0 } })}>复位弧度</button>
                <button className="subtle-button" disabled={selectedRelation.color === null} onClick={() => dispatch({ type: 'UPDATE_RELATION_STYLE', relationId: selectedRelation.id, patch: { color: null } })}>跟随主题</button>
              </div>
              <small className="relation-target-hint">拖动关系线上的锚点调整弧度；双击关系名称可直接编辑，也可拖动箭头端点更换指向。</small>
              <button className="danger-button" onClick={() => dispatch({ type: 'DELETE_RELATION', relationId: selectedRelation.id })}>删除此关系</button>
            </> : selectedNode ? <>
              {inspectorTab === 'content' && <section className="inspector-pane"><label className="field-label" htmlFor="topic">主题</label><textarea id="topic" value={selectedNode.topic} rows={3} onChange={(event) => dispatch({ type: 'UPDATE_NODE_TOPIC', nodeId: selectedNode.id, topic: event.target.value })} /><label className="field-label" htmlFor="node-note">备注</label><GhostNoteEditor value={selectedNode.note} document={document} nodeId={selectedNode.id} onChange={(note) => dispatch({ type: 'UPDATE_NODE_NOTE', nodeId: selectedNode.id, note })} /></section>}
              {inspectorTab === 'tasks' && <section className="inspector-pane">
                <div className="node-marker-controls"><label>任务状态<select value={selectedNode.taskStatus} onChange={(event) => dispatch({ type: 'SET_NODE_TASK_STATUS', nodeId: selectedNode.id, taskStatus: event.target.value as typeof selectedNode.taskStatus })}><option value="none">普通主题</option><option value="todo">待办</option><option value="doing">进行中</option><option value="done">已完成</option></select></label><label>优先级<select value={selectedNode.priority} onChange={(event) => dispatch({ type: 'SET_NODE_PRIORITY', nodeId: selectedNode.id, priority: Number(event.target.value) as typeof selectedNode.priority })}><option value="0">未设置</option><option value="1">P1 · 高</option><option value="2">P2 · 中</option><option value="3">P3 · 低</option></select></label><label className="node-marker-controls__due-date">截止日期<input type="date" value={selectedNode.dueDate ?? ''} disabled={selectedNode.taskStatus === 'none'} onChange={(event) => dispatch({ type: 'SET_NODE_DUE_DATE', nodeId: selectedNode.id, dueDate: event.target.value || null })} /></label></div>
                <div className="node-semantic-section"><p className="field-label">标记</p><div className="node-mark-picker">{nodeMarkOrder.map((mark) => <button key={mark} className={selectedNode.marks.includes(mark) ? 'is-active' : ''} onClick={() => dispatch({ type: 'TOGGLE_NODE_MARK', nodeId: selectedNode.id, mark })} title={nodeMarkMeta[mark].label}>{nodeMarkMeta[mark].icon}<span>{nodeMarkMeta[mark].label}</span></button>)}</div></div>
                <div className="node-semantic-section"><p className="field-label">标签</p><div className="node-tag-list">{selectedNode.tagIds.flatMap((tagId) => { const tag = tags.find((item) => item.id === tagId); return tag ? [<button key={tag.id} onClick={() => setSelectedNodeTags(selectedNode.tagIds.filter((id) => id !== tag.id))}><i style={{ background: tag.color }} />{tag.name} ×</button>] : [] })}</div><form className="node-tag-add" onSubmit={(event) => { event.preventDefault(); addTagToSelectedNode() }}><input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="输入标签，如 #工作" /><button type="submit">添加</button></form>{tags.length > 0 && <div className="node-tag-library">{tags.filter((tag) => !selectedNode.tagIds.includes(tag.id)).map((tag) => <button key={tag.id} onClick={() => setSelectedNodeTags([...selectedNode.tagIds, tag.id])}><i style={{ background: tag.color }} />{tag.name}</button>)}</div>}<details className="tag-library-manager"><summary>管理标签库</summary>{tags.map((tag) => <div key={tag.id}><input type="color" value={tag.color} onChange={(event) => { recolorTag(tag.id, event.target.value) }} /><input defaultValue={tag.name} aria-label={`${tag.name} 标签名称`} onBlur={(event) => { if (event.target.value.trim() !== tag.name) renameTag(tag.id, event.target.value) }} /><button onClick={() => { const count = tagReferenceCount(tag.id); if (window.confirm(`删除“${tag.name}”？${count ? `仍有 ${count} 个节点保留该标签引用。` : ''}`)) deleteTag(tag.id) }}>删除</button></div>)}</details></div>
              </section>}
              {inspectorTab === 'resources' && <section className="inspector-pane"><div className="node-resource-section"><p className="field-label">链接</p>{selectedNode.links.map((link) => { const internal = parseInternalNodeLink(link.url); const resolution = internal ? resolveInternalNodeLink(link.url, taskDocuments) : null; return <div className={`node-resource ${internal && resolution?.status !== 'ok' ? 'is-stale' : ''}`} key={link.id}>{internal ? <button className="node-resource__internal" onClick={() => followNodeLink(link.url)} title={resolution?.status === 'ok' ? `前往 ${resolution.document.title}` : '内部链接已失效'}><span>↗ {link.label}</span><small>{resolution?.status === 'ok' ? resolution.document.title : '链接已失效'}</small></button> : <a href={link.url} target="_blank" rel="noreferrer" title={link.url}>{link.label}</a>}<button onClick={() => dispatch({ type: 'DELETE_NODE_LINK', nodeId: selectedNode.id, linkId: link.id })} aria-label={`删除链接 ${link.label}`}>×</button></div> })}<div className="node-internal-link-actions"><button className="subtle-button" onClick={() => setInternalLinkPickerOpen(true)}>链接工作区节点</button><button className="subtle-button" onClick={() => { void copySelectedNodeLink() }}>复制当前节点链接</button></div><form className="node-link-form" onSubmit={addNodeLink}><input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://…" type="url" /><input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} placeholder="链接名称（可选）" /><button type="submit">添加网页链接</button></form>{linkStatus && <small className="node-resource__hint">{linkStatus}</small>}</div><div className="node-resource-section"><p className="field-label">附件</p><div className="node-image-resources">{selectedNode.attachments.filter((attachment) => attachment.type.startsWith('image/')).map((attachment) => <div className="node-image-resource" key={attachment.id}><AttachmentImage attachment={attachment} variant="inspector" /><button onClick={() => dispatch({ type: 'DELETE_NODE_ATTACHMENT', nodeId: selectedNode.id, attachmentId: attachment.id })} aria-label={`移除附件 ${attachment.name}`}>×</button></div>)}</div>{selectedNode.attachments.filter((attachment) => !attachment.type.startsWith('image/')).map((attachment) => <div className="node-resource" key={attachment.id}><button className="node-resource__file" onClick={() => { void downloadNodeAttachment(attachment.id) }} title="下载本机附件">⌁ {attachment.name}<small>{Math.max(1, Math.ceil(attachment.size / 1024))} KB</small></button><button onClick={() => dispatch({ type: 'DELETE_NODE_ATTACHMENT', nodeId: selectedNode.id, attachmentId: attachment.id })} aria-label={`移除附件 ${attachment.name}`}>×</button></div>)}<input ref={attachmentInputRef} className="node-attachment-input" type="file" accept="image/*,.pdf,.txt,.md,.zip" onChange={(event) => { void uploadNodeAttachment(event) }} /><button className="subtle-button" onClick={() => attachmentInputRef.current?.click()}>添加图片或附件</button><small className="node-resource__hint">图片会显示在节点中；附件仅保存在本机，单个最大 15 MB。</small>{attachmentStatus && <small className="node-resource__hint">{attachmentStatus}</small>}</div></section>}
              {inspectorTab === 'project' && projectStatus && <section className="inspector-pane"><ProjectStatusPanel status={projectStatus} documents={taskDocuments} onRevealSource={revealWorkspaceNode} onRefresh={() => { void refreshProjectStatus() }} onStartDeposit={startDepositForSelectedBranch} refreshing={projectStatusRefreshing} /></section>}
              {inspectorTab === 'map' && <section className="inspector-pane"><div className="property-row"><span>子节点</span><strong>{selectedNode.childIds.length}</strong></div><div className="property-row"><span>状态</span><strong>{selectedNode.collapsed ? '已折叠' : '已展开'}</strong></div><button className="subtle-button" onClick={() => dispatch({ type: 'RESET_NODE_OFFSET', nodeId: selectedNode.id })}>重置节点位置</button><button className="subtle-button" disabled={selectedNode.id === document.rootId || selectedNode.isFreeTopic} onClick={() => dispatch({ type: 'DELETE_SINGLE_NODE', nodeId: selectedNode.id })}>仅删除当前节点并保留子节点</button><button className="danger-button" disabled={selectedNode.id === document.rootId} onClick={() => dispatch({ type: 'DELETE_NODE', nodeId: selectedNode.id })}>删除此分支</button><div className="theme-picker"><p className="eyebrow">主题</p><div className="theme-grid">{themes.map((candidate) => <button key={candidate.id} className={`theme-option ${candidate.id === theme.id ? 'is-active' : ''}`} onClick={() => dispatch({ type: 'APPLY_THEME', themeId: candidate.id })} title={candidate.description}><span className="theme-preview" style={{ background: candidate.canvas }}><i style={{ background: candidate.rootBackground }} />{candidate.palette.slice(0, 3).map((color) => <b key={color} style={{ background: color }} />)}</span><span>{candidate.name}</span></button>)}</div></div><div className="layout-controls"><p className="eyebrow">布局</p><label>层级间距 <output>{document.layout.levelGap}</output></label><input type="range" min="48" max="180" value={document.layout.levelGap} onChange={(event) => dispatch({ type: 'UPDATE_LAYOUT', layout: { levelGap: Number(event.target.value) } })} /><label>同级间距 <output>{document.layout.siblingGap}</output></label><input type="range" min="8" max="72" value={document.layout.siblingGap} onChange={(event) => dispatch({ type: 'UPDATE_LAYOUT', layout: { siblingGap: Number(event.target.value) } })} /></div></section>}
            </> : <section className="inspector-pane"><p className="empty-inspector">选择一个节点，即可编辑内容和查看分支信息。</p><div className="theme-picker"><p className="eyebrow">主题</p><div className="theme-grid">{themes.map((candidate) => <button key={candidate.id} className={`theme-option ${candidate.id === theme.id ? 'is-active' : ''}`} onClick={() => dispatch({ type: 'APPLY_THEME', themeId: candidate.id })} title={candidate.description}><span className="theme-preview" style={{ background: candidate.canvas }}><i style={{ background: candidate.rootBackground }} />{candidate.palette.slice(0, 3).map((color) => <b key={color} style={{ background: color }} />)}</span><span>{candidate.name}</span></button>)}</div></div><div className="layout-controls"><p className="eyebrow">布局</p><label>层级间距 <output>{document.layout.levelGap}</output></label><input type="range" min="48" max="180" value={document.layout.levelGap} onChange={(event) => dispatch({ type: 'UPDATE_LAYOUT', layout: { levelGap: Number(event.target.value) } })} /><label>同级间距 <output>{document.layout.siblingGap}</output></label><input type="range" min="8" max="72" value={document.layout.siblingGap} onChange={(event) => dispatch({ type: 'UPDATE_LAYOUT', layout: { siblingGap: Number(event.target.value) } })} /></div></section>}
          </div>
        </aside>
      </section>

      <footer className="statusbar">
        <span><i className="status-dot" />本地优先</span>
        <span>{Object.keys(document.nodes).length} 个节点</span>
        {document.relations.length > 0 && <span>{document.relations.length} 条关系</span>}
        <span>{syncRemoteVersion === null ? '仅本地' : `云端 v${syncRemoteVersion}`}</span>
        {syncStatus && <span>{syncStatus}</span>}
        {localSaveStatus && <span>{localSaveStatus}</span>}
        {persistenceError && <span className="statusbar-error" role="alert">⚠ {persistenceError}</span>}
        {externalDocumentChange && <span className="statusbar-conflict" role="alert">另一窗口已更新「{externalDocumentChange.title}」<button onClick={() => { void loadExternalDocumentChange() }}>载入并保留当前版本</button><button onClick={() => setExternalDocumentChange(null)}>暂不处理</button></span>}
        {clipboard && <span>已复制「{clipboard.topic}」</span>}
        <span className="status-hint">建立联系后移动鼠标 · 单击已有节点或双击空白处 · 拖动关系箭头可换目标 · ⌘K 命令</span>
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
      {projectCreateOpen && <div className="document-import-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProjectCreateOpen(false) }}>
        <form className="project-create-dialog" role="dialog" aria-modal="true" aria-labelledby="project-create-title" onSubmit={(event) => { event.preventDefault(); addProject() }}>
          <p className="eyebrow">新建项目</p>
          <h2 id="project-create-title">建立一个工作项目</h2>
          <p>项目用于归集多张导图。任务仍保留在各自节点中，由任务中心统一汇总。</p>
          <label>项目名称<input autoFocus value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} placeholder="例如：算法刷题计划" /></label>
          <label>项目说明（可选）<textarea value={projectDescriptionDraft} onChange={(event) => setProjectDescriptionDraft(event.target.value)} placeholder="例如：按专题整理题型、错题和复盘思路" rows={3} /></label>
          <div className="document-import-dialog__actions"><button className="document-import-dialog__primary" type="submit" disabled={!projectNameDraft.trim()}>建立项目</button><button className="document-import-dialog__cancel" type="button" onClick={() => setProjectCreateOpen(false)}>取消</button></div>
        </form>
      </div>}
      {projectRenameTarget && <div className="document-import-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProjectRenameTarget(null) }}>
        <form className="project-create-dialog" role="dialog" aria-modal="true" aria-labelledby="project-rename-title" onSubmit={(event) => { event.preventDefault(); saveProjectRename() }}>
          <p className="eyebrow">项目操作</p>
          <h2 id="project-rename-title">重命名项目</h2>
          <p>项目内的导图、记录及任务不会改变。</p>
          <label>项目名称<input autoFocus value={projectRenameDraft} onChange={(event) => setProjectRenameDraft(event.target.value)} /></label>
          <div className="document-import-dialog__actions"><button className="document-import-dialog__primary" type="submit" disabled={!projectRenameDraft.trim()}>保存名称</button><button className="document-import-dialog__cancel" type="button" onClick={() => setProjectRenameTarget(null)}>取消</button></div>
        </form>
      </div>}
      {documentRenameTarget && <div className="document-import-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDocumentRenameTarget(null) }}>
        <form className="project-create-dialog" role="dialog" aria-modal="true" aria-labelledby="document-rename-title" onSubmit={(event) => { event.preventDefault(); saveDocumentRename() }}>
          <p className="eyebrow">导图操作</p>
          <h2 id="document-rename-title">重命名导图</h2>
          <p>链接、节点内容与历史版本均会保留。</p>
          <label>导图名称<input autoFocus value={documentRenameDraft} onChange={(event) => setDocumentRenameDraft(event.target.value)} /></label>
          <div className="document-import-dialog__actions"><button className="document-import-dialog__primary" type="submit" disabled={!documentRenameDraft.trim()}>保存名称</button><button className="document-import-dialog__cancel" type="button" onClick={() => setDocumentRenameTarget(null)}>取消</button></div>
        </form>
      </div>}
      {taskCenterOpen && <TaskCenterDialog tasks={tasks} tags={tags} onClose={() => setTaskCenterOpen(false)} onOpenTask={openTask} onSetStatus={(task, status) => { void updateTaskStatus(task, status) }} onSetPriority={(task, priority) => { void updateTaskPriority(task, priority) }} onSetDueDate={(task, dueDate) => { void updateTaskDueDate(task, dueDate) }} />}
      {planCenterOpen && <PlanCenterDialog projects={projects.filter((project) => project.status !== 'archived')} documents={savedDocuments} onClose={() => setPlanCenterOpen(false)} onOpenDocument={(item) => { setPlanCenterOpen(false); openDocument(item) }} onCreateDocument={(projectId) => { setPlanCenterOpen(false); void startNewDocument(projectId) }} />}
      {projectOverview && <ProjectOverviewDialog project={projectOverview} documents={taskDocuments} pendingDepositDocumentIds={pendingDepositDocumentIds} onClose={() => setProjectOverviewId(null)} onUpdateProject={updateProject} onOpenDocument={(item) => { setProjectOverviewId(null); openDocument(item) }} onCreateDocument={(projectId, kind) => { setProjectOverviewId(null); void startNewDocument(projectId, kind) }} onOpenAgent={(project) => {
        const projectDocument = taskDocuments.filter((item) => item.projectId === project.id).sort((left, right) => right.updatedAt - left.updatedAt)[0]
        setProjectOverviewId(null)
        if (projectDocument && projectDocument.id !== document.id) openDocument(projectDocument)
        setAssistantTab('chat'); setAssistantContextScope('project'); setAssistantOpen(true); saveAssistantDockOpen(true)
      }} />}
      {!assistantOpen && <QuickAssistant document={document} workspaceDocuments={taskDocuments} onOpenSettings={() => { setAssistantTab('chat'); setAssistantOpen(true); saveAssistantDockOpen(true) }} />}
      {presentationStartNodeId && <PresentationMode document={document} startNodeId={presentationStartNodeId} onClose={() => { if (window.document.fullscreenElement) void window.document.exitFullscreen?.(); setPresentationStartNodeId(null) }} />}
      {workspaceSearchOpen && <NodeSearchDialog currentDocumentId={document.id} documents={taskDocuments} tags={tags} provenance={[]} initialScope="workspace" allowCreate={false} ariaLabel="搜索工作区" onClose={() => setWorkspaceSearchOpen(false)} onSelect={revealWorkspaceSearchResult} />}
      {internalLinkPickerOpen && selectedNode && <NodeSearchDialog currentDocumentId={document.id} documents={taskDocuments} tags={tags} provenance={[]} initialScope="workspace" allowCreate={false} ariaLabel="选择要链接的工作区节点" onClose={() => setInternalLinkPickerOpen(false)} onSelect={addInternalNodeLink} />}
      {importCandidate && <div className="document-import-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !importBusy) setImportCandidate(null) }}>
        <section className="document-import-dialog" role="dialog" aria-modal="true" aria-labelledby="document-import-title">
          <p className="eyebrow">导入导图</p>
          <h2 id="document-import-title">发现同一份导图</h2>
          <p>「{importCandidate.title}」与本机已有导图使用相同 ID。请选择安全的处理方式：</p>
          <div className="document-import-dialog__actions">
            <button className="document-import-dialog__primary" disabled={importBusy} onClick={() => { void completeDocumentImport(importCandidate, 'copy') }}>导入为副本</button>
            <button className="document-import-dialog__secondary" disabled={importBusy} onClick={() => { void completeDocumentImport(importCandidate, 'replace') }}>覆盖本机并保留备份</button>
            <button className="document-import-dialog__cancel" disabled={importBusy} onClick={() => setImportCandidate(null)}>取消</button>
          </div>
          <small>附件文件不会包含在导图 JSON 中；导入后同步会先检查云端版本，避免覆盖远端内容。</small>
        </section>
      </div>}
      {universalImportCandidate && <div className="document-import-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !importBusy) setUniversalImportCandidate(null) }}>
        <section className="document-import-dialog" role="dialog" aria-modal="true" aria-labelledby="universal-import-title">
          <p className="eyebrow">{universalImportCandidate.format} 导入预览</p>
          <h2 id="universal-import-title">{universalImportCandidate.document.title}</h2>
          <p>内容已解析为新的 MindTree 导图。确认结构后再写入工作区，当前导图不会被覆盖。</p>
          <div className="workspace-restore-summary"><strong>{universalImportCandidate.summary.nodeCount} 个节点 · 最大 {universalImportCandidate.summary.maxDepth} 层</strong><span>根主题：{universalImportCandidate.document.nodes[universalImportCandidate.document.rootId].topic}</span></div>
          <div className="document-import-dialog__actions">
            <button className="document-import-dialog__primary" disabled={importBusy} onClick={() => { const candidate = universalImportCandidate.document; setUniversalImportCandidate(null); void completeDocumentImport(candidate, 'replace') }}>导入为新导图</button>
            <button className="document-import-dialog__cancel" disabled={importBusy} onClick={() => setUniversalImportCandidate(null)}>取消</button>
          </div>
          <small>通用格式只转换可表达的层级、顺序、备注和任务状态；MindTree 专有字段请使用 `.mindtree.json` 保真迁移。</small>
        </section>
      </div>}
      {workspaceBackupCandidate && <div className="document-import-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !workspaceBackupBusy) setWorkspaceBackupCandidate(null) }}>
        <section className="document-import-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-restore-title">
          <p className="eyebrow">恢复工作区备份</p>
          <h2 id="workspace-restore-title">安全合并到本机工作区</h2>
          <p>备份包含 {workspaceBackupCandidate.documents.length} 份导图、{workspaceBackupCandidate.versions.length} 条版本历史和 {workspaceBackupCandidate.attachments.length} 个附件。</p>
          <div className="workspace-restore-summary"><strong>{workspaceBackupCollisions ? `${workspaceBackupCollisions} 份同 ID 导图将作为“恢复副本”导入` : '未发现同 ID 导图，可直接安全恢复'}</strong><span>现有工作区不会被清空或覆盖；分类与标签会合并，附件和版本历史会保留关联。</span></div>
          <div className="document-import-dialog__actions">
            <button className="document-import-dialog__primary" disabled={workspaceBackupBusy} onClick={() => { void confirmWorkspaceRestore() }}>安全恢复工作区</button>
            <button className="document-import-dialog__cancel" disabled={workspaceBackupBusy} onClick={() => setWorkspaceBackupCandidate(null)}>取消</button>
          </div>
        </section>
      </div>}
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
            <button className="draft-save-dialog__delete" onClick={() => { void deleteQuickNote(document, pendingNavigation) }}>删除这份随手记</button>
            <button className="draft-save-dialog__cancel" onClick={closeDraftSave}>继续编辑</button>
          </div>
        </section>
      </div>}
      {importStatus && <div className="document-import-status" role="status"><span>{importStatus}</span><button onClick={() => setImportStatus(null)} aria-label="关闭导入提示">×</button></div>}
      {workspaceBackupStatus && <div className="document-import-status" role="status"><span>{workspaceBackupStatus}</span><button onClick={() => setWorkspaceBackupStatus(null)} aria-label="关闭备份提示">×</button></div>}
      {exportStatus && <div className="document-import-status export-save-status" role="status"><span>{exportStatus.message}</span>{exportStatus.path && <button className="document-import-status__action" onClick={() => { void revealExportFile(exportStatus.path!).catch(() => setExportStatus({ message: '文件已保存，但无法在 Finder 中定位。', path: exportStatus.path })) }}>在 Finder 中显示</button>}<button onClick={() => setExportStatus(null)} aria-label="关闭导出提示">×</button></div>}
    </main>
  )
}
