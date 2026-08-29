import {
  Blocks,
  Bot,
  ChevronRight,
  CircleHelp,
  MessageSquareText,
  Plus,
  Settings2,
  SlidersHorizontal,
  Wrench,
  X,
} from "lucide-react";
import type { SessionSummary } from "@ts-piagent/protocol";
import { cn } from "@/lib/utils";

export type AppPage = "chat" | "packages";

interface AppSidebarProps {
  page: AppPage;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: AppPage) => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onPlaceholder: (label: string) => void;
}

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(timestamp);
}

export function AppSidebar({
  page,
  sessions,
  activeSessionId,
  isOpen,
  onClose,
  onNavigate,
  onNewSession,
  onSelectSession,
  onPlaceholder,
}: AppSidebarProps) {
  const navigate = (nextPage: AppPage) => {
    onNavigate(nextPage);
    onClose();
  };

  return (
    <>
      <button
        type="button"
        aria-label="关闭导航"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/55 backdrop-blur-[2px] transition-opacity lg:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[292px] flex-col border-r border-white/[0.06] bg-[#0b0d0f] px-3.5 py-4 text-[#f5f7f7] transition-transform duration-300 lg:static lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-1.5">
          <button
            type="button"
            onClick={() => navigate("chat")}
            className="group flex items-center gap-3 text-left"
          >
            <span className="relative grid h-9 w-9 place-items-center rounded-[11px] bg-[#d7ff62] text-[#101309] shadow-[0_0_28px_rgba(215,255,98,0.12)] transition-transform group-hover:scale-[1.04]">
              <Bot size={19} strokeWidth={2.2} />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0b0d0f] bg-[#75efad]" />
            </span>
            <span>
              <span className="block text-[15px] font-semibold tracking-[-0.02em]">
                Ts-PiAgent
              </span>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-white/36">
                Agent Workspace
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label="关闭导航"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-white/45 hover:bg-white/[0.06] hover:text-white lg:hidden"
          >
            <X size={17} />
          </button>
        </div>

        <button
          type="button"
          onClick={onNewSession}
          className="mt-5 flex h-10 items-center justify-between rounded-xl bg-[#d7ff62] px-3.5 text-[13px] font-semibold text-[#11150a] transition hover:bg-[#e1ff83] active:scale-[0.985]"
        >
          <span className="flex items-center gap-2">
            <Plus size={16} strokeWidth={2.4} />
            新建会话
          </span>
          <span className="font-mono text-[10px] text-[#11150a]/45">⌘ N</span>
        </button>

        <nav className="mt-5 space-y-1" aria-label="主导航">
          <NavButton
            active={page === "chat"}
            icon={<MessageSquareText size={16} />}
            label="对话"
            onClick={() => navigate("chat")}
          />
          <NavButton
            active={page === "packages"}
            icon={<Blocks size={16} />}
            label="Package 能力"
            suffix="4"
            onClick={() => navigate("packages")}
          />
          <NavButton
            icon={<Wrench size={16} />}
            label="工具"
            suffix="即将接入"
            onClick={() => onPlaceholder("工具管理")}
          />
          <NavButton
            icon={<SlidersHorizontal size={16} />}
            label="模型与配置"
            onClick={() => onPlaceholder("模型与配置")}
          />
        </nav>

        <div className="mt-7 flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">
              最近会话
            </span>
            <button
              type="button"
              onClick={() => onPlaceholder("会话搜索")}
              className="text-[11px] text-white/35 transition hover:text-white/70"
            >
              搜索
            </button>
          </div>

          <div className="mt-2 min-h-0 space-y-1 overflow-y-auto pr-0.5">
            {sessions.length === 0 ? (
              <div className="px-2 py-6 text-xs leading-5 text-white/30">
                还没有会话。
                <br />
                创建一个开始测试 Agent。
              </div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => {
                    onSelectSession(session.id);
                    onClose();
                  }}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition",
                    activeSessionId === session.id && page === "chat"
                      ? "bg-white/[0.075] text-white"
                      : "text-white/52 hover:bg-white/[0.045] hover:text-white/80",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      activeSessionId === session.id
                        ? "bg-[#d7ff62]"
                        : "bg-white/15",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">
                      {session.title || "新会话"}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-white/28">
                      {session.messageCount} 条消息 · {relativeTime(session.updatedAt)}
                    </span>
                  </span>
                  <ChevronRight
                    size={13}
                    className="opacity-0 transition group-hover:opacity-60"
                  />
                </button>
              ))
            )}
          </div>
        </div>

        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <NavButton
            icon={<CircleHelp size={16} />}
            label="使用说明"
            onClick={() => onPlaceholder("使用说明")}
          />
          <NavButton
            icon={<Settings2 size={16} />}
            label="设置"
            onClick={() => onPlaceholder("设置")}
          />
          <div className="mt-3 flex items-center gap-2 px-2.5 text-[10px] text-white/28">
            <span className="h-1.5 w-1.5 rounded-full bg-[#75efad] shadow-[0_0_8px_rgba(117,239,173,0.7)]" />
            Local runtime · v1.0.0
          </div>
        </div>
      </aside>
    </>
  );
}

function NavButton({
  active = false,
  icon,
  label,
  suffix,
  onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  suffix?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-[12.5px] transition",
        active
          ? "bg-white/[0.075] font-medium text-white"
          : "text-white/48 hover:bg-white/[0.045] hover:text-white/80",
      )}
    >
      <span className={cn(active ? "text-[#d7ff62]" : "text-white/38")}>
        {icon}
      </span>
      <span>{label}</span>
      {suffix && (
        <span className="ml-auto rounded-md bg-white/[0.055] px-1.5 py-0.5 text-[9px] text-white/34">
          {suffix}
        </span>
      )}
    </button>
  );
}
