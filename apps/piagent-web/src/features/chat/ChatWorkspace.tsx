import { useState } from "react";
import {
  Activity,
  ChevronDown,
  Menu,
  MoreHorizontal,
  PanelRight,
  Radio,
  Sparkles,
  X,
} from "lucide-react";
import { ChatView } from "./ChatView";
import { useSessionStore } from "@/store/sessionStore";

interface ChatWorkspaceProps {
  title: string;
  onMenu: () => void;
  onOpenPackages: () => void;
  onPlaceholder: (label: string) => void;
  onSessionActivity: () => void;
}

export function ChatWorkspace({
  title,
  onMenu,
  onOpenPackages,
  onPlaceholder,
  onSessionActivity,
}: ChatWorkspaceProps) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const isRunning = useSessionStore((state) => state.isRunning);
  const currentTool = useSessionStore((state) => state.currentTool);

  return (
    <div className="relative flex h-full min-w-0 flex-1 overflow-hidden bg-[#f5f6f4]">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-black/[0.065] bg-[#f8f9f7]/90 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={onMenu}
            aria-label="打开导航"
            className="grid h-9 w-9 place-items-center rounded-xl text-[#5e655f] transition hover:bg-black/[0.045] lg:hidden"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[#171a18]">
                {title}
              </h1>
              <ChevronDown size={13} className="shrink-0 text-[#929792]" />
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[#818781]">
              <span
                className={
                  isRunning
                    ? "status-pulse h-1.5 w-1.5 rounded-full bg-[#7d9d20]"
                    : "h-1.5 w-1.5 rounded-full bg-[#69a879]"
                }
              />
              {isRunning
                ? currentTool
                  ? `正在调用 ${currentTool}`
                  : "Agent 正在运行"
                : "会话已就绪"}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onPlaceholder("模型选择")}
            className="hidden h-9 items-center gap-2 rounded-xl border border-black/[0.07] bg-white/65 px-3 text-[11px] font-medium text-[#4d534e] transition hover:bg-white sm:flex"
          >
            <Sparkles size={13} className="text-[#758f2a]" />
            ScriptedModel
            <ChevronDown size={12} className="text-[#a0a49f]" />
          </button>
          <button
            type="button"
            onClick={() => setInspectorOpen((open) => !open)}
            aria-label="运行详情"
            className="grid h-9 w-9 place-items-center rounded-xl border border-black/[0.07] bg-white/65 text-[#5c625d] transition hover:bg-white"
          >
            <PanelRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => onPlaceholder("更多会话操作")}
            aria-label="更多"
            className="grid h-9 w-9 place-items-center rounded-xl text-[#777d78] transition hover:bg-black/[0.045]"
          >
            <MoreHorizontal size={18} />
          </button>
        </header>

        <ChatView
          onOpenPackages={onOpenPackages}
          onPlaceholder={onPlaceholder}
          onSessionActivity={onSessionActivity}
        />
      </section>

      <aside
        className={`absolute inset-y-0 right-0 z-20 flex w-[310px] flex-col border-l border-black/[0.07] bg-[#fbfcfa] shadow-[-18px_0_50px_rgba(18,24,19,0.06)] transition-transform duration-300 xl:relative xl:shadow-none ${
          inspectorOpen
            ? "translate-x-0"
            : "translate-x-full xl:hidden"
        }`}
      >
        <div className="flex h-[68px] items-center justify-between border-b border-black/[0.06] px-5">
          <div>
            <h2 className="text-[13px] font-semibold text-[#222622]">运行详情</h2>
            <p className="mt-0.5 text-[10px] text-[#90958f]">实时事件与会话上下文</p>
          </div>
          <button
            type="button"
            onClick={() => setInspectorOpen(false)}
            className="grid h-8 w-8 place-items-center rounded-lg text-[#8b908b] hover:bg-black/[0.04]"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#edf4d9] text-[#6f8b22]">
                <Radio size={15} />
              </span>
              <div>
                <p className="text-[11px] font-semibold text-[#313631]">Event Stream</p>
                <p className="text-[10px] text-[#969b96]">SSE · 顺序事件</p>
              </div>
            </div>
            <span className="rounded-full bg-[#eaf5ed] px-2 py-1 text-[9px] font-medium text-[#4a815a]">
              已连接
            </span>
          </div>

          <div className="py-5">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a0a59f]">
              <Activity size={12} />
              当前运行
            </div>
            {isRunning ? (
              <div className="mt-4 border-l border-[#cddc9e] pl-4">
                <p className="text-[12px] font-medium text-[#2a2f2a]">
                  Agent 正在处理请求
                </p>
                <p className="mt-1 text-[10px] leading-5 text-[#858b85]">
                  新事件会通过 SSE 写入当前会话。工具调用将在这里形成执行轨迹。
                </p>
              </div>
            ) : (
              <p className="mt-4 text-[11px] leading-5 text-[#969b96]">
                发送一条消息后，这里将展示 Turn、模型响应和工具调用状态。
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenPackages}
            className="flex w-full items-center justify-between border-t border-black/[0.06] py-4 text-left group"
          >
            <span>
              <span className="block text-[11px] font-semibold text-[#343934]">
                查看 Package 能力
              </span>
              <span className="mt-1 block text-[10px] text-[#969b96]">
                理解事件从哪里产生
              </span>
            </span>
            <ChevronDown
              size={14}
              className="-rotate-90 text-[#a1a6a1] transition-transform group-hover:translate-x-0.5"
            />
          </button>
        </div>
      </aside>
    </div>
  );
}
