import { useState } from "react";
import {
  ArrowRight,
  Blocks,
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  Database,
  Menu,
  Network,
  Play,
  Radio,
  Sparkles,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PackageCapabilitiesProps {
  onMenu: () => void;
  onStartChat: () => void;
  onPlaceholder: (label: string) => void;
}

const packages = [
  {
    id: "agent",
    name: "@ts-piagent/agent",
    label: "Agent Loop",
    description: "模型调用、工具执行和生命周期事件的最小闭环。",
    icon: Bot,
    status: "可用",
    details: ["最多 8 轮运行", "并行工具调用", "AbortSignal", "生命周期事件"],
  },
  {
    id: "session",
    name: "@ts-piagent/session",
    label: "Session Tree",
    description: "追加式会话存储、崩溃恢复、分支和时间旅行。",
    icon: Database,
    status: "可用",
    details: ["JSONL append-only", "崩溃恢复", "会话树", "checkout 分支"],
  },
  {
    id: "provider",
    name: "@ts-piagent/openai-provider",
    label: "Model Provider",
    description: "将 OpenAI 兼容接口适配为统一的 Model 契约。",
    icon: Sparkles,
    status: "可用",
    details: ["Chat Completions", "工具参数解析", "兼容 Base URL", "统一消息转换"],
  },
  {
    id: "protocol",
    name: "@ts-piagent/protocol",
    label: "Web Protocol",
    description: "在 Agent、Server 与 React 之间共享事件和 DTO。",
    icon: Braces,
    status: "可用",
    details: ["共享类型", "API 路由", "SSE Envelope", "会话树 DTO"],
  },
] as const;

const flow = [
  { label: "用户输入", icon: CircleDot },
  { label: "模型生成", icon: Sparkles },
  { label: "工具执行", icon: Wrench },
  { label: "事件推送", icon: Radio },
  { label: "会话落盘", icon: Database },
] as const;

export function PackageCapabilities({
  onMenu,
  onStartChat,
  onPlaceholder,
}: PackageCapabilitiesProps) {
  const [selectedId, setSelectedId] = useState<(typeof packages)[number]["id"]>(
    "agent",
  );
  const selected = packages.find((item) => item.id === selectedId) ?? packages[0];
  const SelectedIcon = selected.icon;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[#f5f6f4]">
      <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-black/[0.065] bg-[#f8f9f7]/90 px-4 backdrop-blur-xl sm:px-6">
        <button
          type="button"
          onClick={onMenu}
          aria-label="打开导航"
          className="grid h-9 w-9 place-items-center rounded-xl text-[#5e655f] hover:bg-black/[0.045] lg:hidden"
        >
          <Menu size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold tracking-[-0.02em] text-[#171a18]">
            Package 能力
          </h1>
          <p className="mt-0.5 text-[10px] text-[#818781]">
            让 Agent 内核从代码变成可以观察和操作的产品能力
          </p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/60 px-3 py-1.5 text-[10px] text-[#697069] sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-[#72a15b]" />4 个 Package 已接入
        </span>
        <button
          type="button"
          onClick={onStartChat}
          className="flex h-9 items-center gap-2 rounded-xl bg-[#171b18] px-3.5 text-[11px] font-medium text-white transition hover:bg-[#272c28]"
        >
          <Play size={13} fill="currentColor" />
          运行 Agent
        </button>
      </header>

      <main className="capability-enter flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 sm:py-10">
          <section className="border-b border-black/[0.07] pb-9">
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div className="max-w-2xl">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#849153]">
                  <Blocks size={13} />
                  Core capabilities
                </div>
                <h2 className="text-3xl font-semibold leading-[1.12] tracking-[-0.045em] text-[#171b18] sm:text-[40px]">
                  从一次输入，到一个
                  <br className="hidden sm:block" />
                  可恢复的 Agent 会话。
                </h2>
              </div>
              <p className="max-w-sm text-[12px] leading-6 text-[#737a74]">
                这个页面会随着 Package 演进逐步变成实时能力实验室。当前先展示已经存在的模块边界与运行闭环。
              </p>
            </div>

            <div className="mt-9 overflow-x-auto pb-2">
              <div className="flex min-w-[720px] items-center">
                {flow.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <div key={step.label} className="flex flex-1 items-center last:flex-none">
                      <div className="group flex items-center gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-xl border border-black/[0.07] bg-white text-[#697a35] shadow-[0_5px_18px_rgba(30,40,31,0.04)] transition-transform group-hover:-translate-y-0.5">
                          <Icon size={16} />
                        </span>
                        <div>
                          <span className="block font-mono text-[9px] text-[#afb3ae]">
                            0{index + 1}
                          </span>
                          <span className="block text-[11px] font-medium text-[#4f5550]">
                            {step.label}
                          </span>
                        </div>
                      </div>
                      {index < flow.length - 1 && (
                        <div className="mx-5 h-px min-w-8 flex-1 bg-black/[0.09]">
                          <span className="flow-signal block h-px w-8 bg-[#9cb448]" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="grid gap-8 py-9 lg:grid-cols-[310px_1fr] lg:gap-14">
            <div>
              <div className="mb-3 px-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#9a9f99]">
                Packages
              </div>
              <div className="border-t border-black/[0.07]">
                {packages.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === selected.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={cn(
                        "group flex w-full items-center gap-3 border-b border-black/[0.07] px-1 py-4 text-left transition",
                        active ? "text-[#202520]" : "text-[#717771] hover:text-[#303530]",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-8 w-8 place-items-center rounded-lg transition",
                          active
                            ? "bg-[#dffb88] text-[#53691a]"
                            : "bg-black/[0.035] text-[#929791] group-hover:bg-black/[0.055]",
                        )}
                      >
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-semibold">{item.label}</span>
                        <span className="mt-0.5 block truncate font-mono text-[9px] text-[#a1a6a0]">
                          {item.name}
                        </span>
                      </span>
                      <ChevronRight
                        size={14}
                        className={cn(active ? "text-[#829a3b]" : "text-[#b7bbb6]")}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0 lg:pt-4">
              <div className="flex items-start justify-between gap-4">
                <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-[#171b18] text-[#d7ff62]">
                  <SelectedIcon size={20} />
                </span>
                <span className="flex items-center gap-1.5 rounded-full bg-[#e9f3e6] px-2.5 py-1 text-[9px] font-medium text-[#4f7f57]">
                  <Check size={10} strokeWidth={2.5} />
                  {selected.status}
                </span>
              </div>
              <div className="mt-6 border-b border-black/[0.07] pb-7">
                <p className="font-mono text-[10px] text-[#9ba09a]">{selected.name}</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-[#1f241f]">
                  {selected.label}
                </h3>
                <p className="mt-3 max-w-xl text-[13px] leading-6 text-[#697069]">
                  {selected.description}
                </p>
              </div>
              <div className="grid gap-x-8 sm:grid-cols-2">
                {selected.details.map((detail) => (
                  <div
                    key={detail}
                    className="flex items-center gap-2.5 border-b border-black/[0.06] py-4 text-[11px] font-medium text-[#565d57]"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-[#9bb64a]" />
                    {detail}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onPlaceholder(`${selected.label} 交互演示`)}
                className="group mt-7 flex items-center gap-2 text-[11px] font-semibold text-[#3e4930]"
              >
                打开交互演示
                <ArrowRight size={13} className="transition-transform group-hover:translate-x-1" />
                <span className="rounded bg-black/[0.04] px-1.5 py-0.5 text-[9px] font-normal text-[#979c97]">
                  建设中
                </span>
              </button>
            </div>
          </section>

          <section className="flex flex-col justify-between gap-6 border-t border-black/[0.07] py-8 md:flex-row md:items-center">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-[#82993e]">
                <Network size={17} />
              </span>
              <div>
                <h3 className="text-[13px] font-semibold text-[#303530]">能力可视化路线</h3>
                <p className="mt-1 max-w-xl text-[11px] leading-5 text-[#858b85]">
                  后续将在这里加入事件回放、会话树、工具沙箱和模型调用检查器，让每个 Package 都能直接操作和观察。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onPlaceholder("能力路线图")}
              className="shrink-0 self-start rounded-xl border border-black/[0.08] bg-white/50 px-4 py-2.5 text-[10px] font-semibold text-[#596059] transition hover:bg-white md:self-auto"
            >
              查看路线图
            </button>
          </section>
        </div>
      </main>
    </div>
  );
}
