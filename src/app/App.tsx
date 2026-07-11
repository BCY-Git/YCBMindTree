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
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { MindMapCanvas } from '../editor/MindMapCanvas'
import { getSyncMetadata, listDocumentVersions, listDocuments, loadLatestDocument, saveDocument, saveDocumentVersion, saveSyncMetadata } from '../persistence/database'
import { useEditorStore } from '../store/editor.store'
import { getTheme, themes } from '../domain/themes'
import { AiAssistant } from '../ai/AiAssistant'
import type { MindMapDocument } from '../domain/document.types'
import { SyncDialog } from '../sync/SyncDialog'
import { createPairingInvite, fetchRemoteDocument, loadSyncConfig, pushDocument, redeemPairingInvite, saveSyncConfig, type PairingInvite, type RemoteDocument, type SyncConfig } from '../sync/sync-client'
import { VersionHistoryDialog } from '../history/VersionHistoryDialog'
import { createDocumentVersion, duplicateDocumentVersion, restoreDocumentVersion, type DocumentVersion } from '../history/version-history'

// 工具栏图标包装组件（aria-hidden，不暴露给屏幕阅读器）。
function Icon({ children }: { children: ReactNode }) {
  return <span aria-hidden="true" className="toolbar-icon">{children}</span>
}

type Category = { id: string; name: string }

// localStorage key for persisting user-defined categories.
const categoryStorageKey = 'mindtree.categories.v1'
const defaultCategories: Category[] = [{ id: 'uncategorized', name: '未分类' }]

// Load categories from localStorage, always prepend the default.
function loadCategories(): Category[] {
  try {
    const stored = JSON.parse(localStorage.getItem(categoryStorageKey) ?? '[]') as Category[]
    return [...defaultCategories, ...stored.filter((item) => item?.id && item?.name && item.id !== 'uncategorized')]
  } catch {
    return defaultCategories
  }
}

function saveCategories(categories: Category[]) {
  localStorage.setItem(categoryStorageKey, JSON.stringify(categories.filter((item) => item.id !== 'uncategorized')))
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
  const clipboard = useEditorStore((state) => state.clipboard)
  const [documents, setDocuments] = useState<MindMapDocument[]>([])
  const [categories, setCategories] = useState<Category[]>(loadCategories)
  const [activeCategoryId, setActiveCategoryId] = useState('all')
  const [categoryDraft, setCategoryDraft] = useState('')
  const [showCategoryInput, setShowCategoryInput] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
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
  const pendingSaveRef = useRef<number | null>(null)
  const pendingSnapshotRef = useRef<number | null>(null)
  const observedVersionRef = useRef<{ documentId: string; updatedAt: number } | null>(null)
  const selectedNode = selectedNodeId ? document.nodes[selectedNodeId] : null
  const selectedRelation = selectedRelationId ? document.relations.find((relation) => relation.id === selectedRelationId) ?? null : null
  const theme = getTheme(document.theme.id)
  const visibleDocuments = useMemo(() => activeCategoryId === 'all'
    ? documents
    : documents.filter((item) => item.categoryId === activeCategoryId), [activeCategoryId, documents])
  const categoryName = (id: string) => categories.find((category) => category.id === id)?.name ?? '未分类'

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
    await persistDocument(document)
  }, [document, hydrated, persistDocument])

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

  const openDocument = useCallback(async (nextDocument: MindMapDocument) => {
    if (nextDocument.id === document.id) return
    await flushCurrentDocument()
    hydrate(nextDocument)
  }, [document.id, flushCurrentDocument, hydrate])

  const startNewDocument = useCallback(async () => {
    await flushCurrentDocument()
    createDocument()
    setActiveCategoryId('uncategorized')
  }, [createDocument, flushCurrentDocument])

  const saveSyncSettings = useCallback((nextConfig: SyncConfig) => {
    saveSyncConfig(nextConfig)
    setSyncConfig(nextConfig)
    setSyncStatus('连接设置已保存在此浏览器。')
  }, [])

  const uploadToCloud = useCallback(async (config: SyncConfig) => {
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
    const backup: MindMapDocument = { ...currentDoc, id: crypto.randomUUID(), title: `${currentDoc.title}（同步前备份）`, createdAt: now, updatedAt: now }
    await saveDocumentVersion(createDocumentVersion(currentDoc, 'sync-backup', '同步前备份'))
    await saveDocument(backup)
    await saveDocument(remote.payload)
    await saveSyncMetadata({ documentId: remote.payload.id, remoteVersion: remote.version, syncedAt: now })
    setDocuments((current) => [remote.payload, backup, ...current.filter((item) => item.id !== remote.payload.id && item.id !== backup.id)]
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
          <span className="save-state">{hydrated ? '已本地保存' : '正在打开…'}</span>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" onClick={undo} disabled={!past.length} title="撤销 (⌘Z)"><Icon>↶</Icon></button>
          <button className="icon-button" onClick={redo} disabled={!future.length} title="重做 (⇧⌘Z)"><Icon>↷</Icon></button>
          <span className="toolbar-divider" />
          <button className="toolbar-button" onClick={() => dispatch({ type: 'ADD_CHILD', parentId: selectedNodeId ?? document.rootId })}><Icon>＋</Icon>子节点</button>
          <button className="toolbar-button toolbar-button--dark" disabled={(selectedNodeId ?? document.rootId) === document.rootId} onClick={() => dispatch({ type: 'ADD_SIBLING', nodeId: selectedNodeId ?? document.rootId })}><Icon>↳</Icon>同级</button>
          <button className="toolbar-button" onClick={() => dispatch({ type: 'AUTO_ARRANGE' })} title="自动排列并保留当前自由排布"><Icon>↺</Icon>排列</button>
          <button className="toolbar-button" onClick={() => setHistoryOpen(true)} title="查看或恢复本地版本"><Icon>◷</Icon>历史</button>
          <button className="toolbar-button" onClick={() => setSyncOpen(true)} title="上传或拉取云端导图"><Icon>⇅</Icon>同步</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="left-rail">
          {sidebarCollapsed ? (
            <button className="sidebar-expand" onClick={toggleSidebar} title="展开侧栏" aria-label="展开侧栏"><span>M</span><i>›</i></button>
          ) : <>
          <div className="sidebar-scroll">
            <div className="sidebar-workspace-name"><span className="sidebar-workspace-mark">M</span><strong>我的工作区</strong><button onClick={toggleSidebar} aria-label="收起侧栏" title="收起侧栏">‹</button></div>
            <button className="sidebar-create" onClick={() => { void startNewDocument() }}><span>＋</span>新建导图</button>

            <section className="sidebar-section">
              <p className="sidebar-section__title">项目</p>
              <button className={`sidebar-nav-item ${activeCategoryId === 'all' ? 'is-active' : ''}`} onClick={() => setActiveCategoryId('all')}><span>◫</span>全部导图 <small>{documents.length}</small></button>
              {categories.map((category) => {
                const count = documents.filter((item) => item.categoryId === category.id).length
                return <button key={category.id} className={`sidebar-nav-item ${activeCategoryId === category.id ? 'is-active' : ''}`} onClick={() => setActiveCategoryId(category.id)}><span>⌁</span>{category.name}<small>{count}</small></button>
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
              <p className="sidebar-section__title">助手</p>
              <AiAssistant document={document} targetNodeId={selectedNodeId ?? document.rootId} />
            </section>
          </div>
          <footer className="sidebar-footer">
            <button className="sidebar-footer-action" type="button"><span>⚙</span>设置</button>
            <button className="sidebar-footer-action" type="button"><span>?</span>帮助与反馈</button>
            <div className="sidebar-account">
              <button className="sidebar-account__trigger" onClick={() => setAccountMenuOpen((open) => !open)}><span className="sidebar-avatar">M</span><span><strong>本地工作区</strong><small>未登录 · 本地保存</small></span><i>⋮</i></button>
              {accountMenuOpen && <div className="sidebar-account__menu"><strong>同步账号</strong><p>账号登录将在同步服务接入后启用。</p><button disabled>登录账号</button><button disabled>退出登录</button></div>}
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
    </main>
  )
}
