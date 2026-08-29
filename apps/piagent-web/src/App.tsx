import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionSummary } from "@ts-piagent/protocol";
import { CheckCircle2, X } from "lucide-react";
import { useSessionStore } from "@/store/sessionStore";
import { sessionApi } from "@/api/sessions";
import { AppSidebar, type AppPage } from "@/components/layout/AppSidebar";
import { ChatWorkspace } from "@/features/chat/ChatWorkspace";
import { PackageCapabilities } from "@/features/packages/PackageCapabilities";

/**
 * 产品外壳：统一管理一级页面、会话选择和全局占位反馈。
 * 聊天仍由 SSE 事件驱动；Package 页面独立承载内核能力的可视化入口。
 */
export function App() {
  const [page, setPage] = useState<AppPage>("chat");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionId = useSessionStore((s) => s.sessionId);
  const setSession = useSessionStore((s) => s.setSession);
  const hydrateTree = useSessionStore((s) => s.hydrateTree);
  const setError = useSessionStore((s) => s.setError);

  const refreshSessions = useCallback(async () => {
    const items = await sessionApi.list();
    setSessions(items);
    return items;
  }, []);

  const selectSession = useCallback(
    async (id: string) => {
      setSession(id);
      setPage("chat");
      try {
        const tree = await sessionApi.getTree(id);
        hydrateTree(tree);
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      }
    },
    [hydrateTree, setError, setSession],
  );

  const createSession = useCallback(async () => {
    try {
      const created = await sessionApi.create();
      await selectSession(created.id);
      await refreshSessions();
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法创建会话");
    }
  }, [refreshSessions, selectSession, setError]);

  useEffect(() => {
    if (sessionId) return;
    let active = true;
    void (async () => {
      try {
        const items = await refreshSessions();
        if (!active) return;
        if (items[0]) await selectSession(items[0].id);
        else await createSession();
      } catch (error) {
        if (active) {
          setError(error instanceof Error ? error.message : "无法连接 Agent 服务");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [createSession, refreshSessions, selectSession, sessionId, setError]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createSession();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createSession]);

  const activeTitle = useMemo(
    () => sessions.find((session) => session.id === sessionId)?.title ?? "新会话",
    [sessionId, sessions],
  );

  const showPlaceholder = useCallback((label: string) => {
    setNotice(`${label}已预留，将随 Agent 能力逐步接入`);
  }, []);

  const handleSessionActivity = useCallback(() => {
    void refreshSessions();
  }, [refreshSessions]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#f5f6f4]">
      <AppSidebar
        page={page}
        sessions={sessions}
        activeSessionId={sessionId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNavigate={setPage}
        onNewSession={() => void createSession()}
        onSelectSession={(id) => void selectSession(id)}
        onPlaceholder={showPlaceholder}
      />

      {page === "chat" ? (
        <ChatWorkspace
          title={activeTitle}
          onMenu={() => setSidebarOpen(true)}
          onOpenPackages={() => setPage("packages")}
          onPlaceholder={showPlaceholder}
          onSessionActivity={handleSessionActivity}
        />
      ) : (
        <PackageCapabilities
          onMenu={() => setSidebarOpen(true)}
          onStartChat={() => setPage("chat")}
          onPlaceholder={showPlaceholder}
        />
      )}

      <div
        className={`pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 transition-all duration-300 ${
          notice ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        }`}
      >
        <div className="pointer-events-auto flex min-w-[280px] items-center gap-2.5 rounded-xl border border-white/10 bg-[#171a18] px-3.5 py-3 text-[11px] text-white shadow-2xl">
          <CheckCircle2 size={15} className="shrink-0 text-[#d7ff62]" />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
            className="text-white/40 hover:text-white"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
