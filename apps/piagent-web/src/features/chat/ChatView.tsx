import { useEffect, useRef } from "react";
import { ArrowRight, Blocks, Bot, PlugZap, RotateCcw } from "lucide-react";
import { useSessionStore } from "@/store/sessionStore";
import { subscribeSessionEvents } from "@/api/events";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";

/**
 * ★ 难点 3：事件驱动的消息渲染容器。
 *
 * ChatView 本身几乎无状态——状态全在 store。它只做两件事：
 * 1. useEffect 里为当前会话建立 SSE 订阅：事件到达 → store.applyEvent。
 *    依赖数组是 [sessionId]，切换会话时自动清理旧订阅、建立新订阅。
 * 2. 从 store 读 messages，map 成气泡渲染。
 *
 * 这就是单向数据流：SSE → store.applyEvent → state 变化 → 组件重渲染。
 */
interface ChatViewProps {
  onOpenPackages: () => void;
  onPlaceholder: (label: string) => void;
  onSessionActivity: () => void;
}

export function ChatView({
  onOpenPackages,
  onPlaceholder,
  onSessionActivity,
}: ChatViewProps) {
  const sessionId = useSessionStore((s) => s.sessionId);
  const messages = useSessionStore((s) => s.messages);
  const applyEvent = useSessionStore((s) => s.applyEvent);
  const error = useSessionStore((s) => s.error);
  const setError = useSessionStore((s) => s.setError);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 建立 / 清理 SSE 订阅
  useEffect(() => {
    if (!sessionId) return;
    const unsubscribe = subscribeSessionEvents(sessionId, {
      onEvent: (envelope) => {
        applyEvent(envelope.event);
        if (envelope.event.type === "agent_end") onSessionActivity();
      },
      onError: () => setError("实时连接已中断，浏览器正在尝试重新连接"),
    });
    return unsubscribe; // 组件卸载 / sessionId 变化时关闭连接
  }, [sessionId, applyEvent, onSessionActivity, setError]);

  // 新消息自动滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="chat-scroll flex-1 overflow-y-auto px-4 sm:px-8">
        {messages.length === 0 ? (
          <div className="empty-enter mx-auto flex min-h-full max-w-[760px] flex-col pb-12 pt-10 sm:pt-14">
            <div className="flex items-center gap-3">
              <span className="relative grid h-11 w-11 place-items-center rounded-[14px] bg-[#171b18] text-[#d7ff62] shadow-[0_12px_30px_rgba(18,24,19,0.12)]">
                <Bot size={21} />
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#f5f6f4] bg-[#75b783]" />
              </span>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-[0.15em] text-[#929991]">
                  Ready
                </span>
                <span className="block text-[12px] font-medium text-[#535a54]">
                  Agent Runtime 已连接
                </span>
              </div>
            </div>

            <h2 className="mt-7 max-w-xl text-[30px] font-semibold leading-[1.15] tracking-[-0.045em] text-[#191d1a] sm:text-[38px]">
              和你的 Agent
              <br />
              开始一次真实运行。
            </h2>
            <p className="mt-4 max-w-lg text-[12px] leading-6 text-[#747b75]">
              消息会进入 Agent Loop；模型响应、工具调用和会话事件将实时回到这个工作区。
            </p>

            <div className="mt-8 border-t border-black/[0.075]">
              <QuickAction
                icon={<RotateCcw size={15} />}
                title="测试 Agent Loop"
                description="发送一条消息，观察完整运行链路"
                onClick={() => onPlaceholder("快捷测试提示词")}
              />
              <QuickAction
                icon={<Blocks size={15} />}
                title="浏览 Package 能力"
                description="查看当前已经接入的内核模块"
                onClick={onOpenPackages}
              />
              <QuickAction
                icon={<PlugZap size={15} />}
                title="连接第一个工具"
                description="工具管理入口已预留"
                onClick={() => onPlaceholder("工具接入")}
              />
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[820px] space-y-1 py-8 sm:py-12">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {error && (
        <div className="mx-auto mb-1 flex w-[calc(100%-2rem)] max-w-[820px] items-center justify-between rounded-lg bg-[#f2e8dc] px-3 py-2 text-[10px] text-[#865d3c]">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="font-semibold">
            知道了
          </button>
        </div>
      )}
      <Composer onPlaceholder={onPlaceholder} />
    </div>
  );
}

function QuickAction({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 border-b border-black/[0.075] py-3.5 text-left transition hover:pl-1"
    >
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-black/[0.035] text-[#778440] transition group-hover:bg-[#e7f2c8] group-hover:text-[#61751e]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold text-[#3d433e]">{title}</span>
        <span className="mt-0.5 block text-[10px] text-[#929792]">{description}</span>
      </span>
      <ArrowRight
        size={13}
        className="text-[#b1b5b0] transition-transform group-hover:translate-x-1 group-hover:text-[#778440]"
      />
    </button>
  );
}
