import { useState, type KeyboardEvent } from "react";
import { ArrowUp, AtSign, Paperclip, SlidersHorizontal } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useSessionStore } from "@/store/sessionStore";
import { sessionApi } from "@/api/sessions";

export function Composer({
  onPlaceholder,
}: {
  onPlaceholder: (label: string) => void;
}) {
  const [text, setText] = useState("");
  const sessionId = useSessionStore((s) => s.sessionId);
  const isRunning = useSessionStore((s) => s.isRunning);
  const setError = useSessionStore((s) => s.setError);

  const send = async () => {
    const content = text.trim();
    if (!content || !sessionId || isRunning) return;
    setText("");
    setError(null);
    try {
      // 发消息只负责触发；渲染由 SSE 事件驱动（见 ChatView）
      await sessionApi.sendMessage(sessionId, content);
    } catch (error) {
      setText(content);
      setError(error instanceof Error ? error.message : "消息发送失败");
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送，Shift+Enter 换行
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="shrink-0 px-4 pb-4 pt-2 sm:px-8 sm:pb-6">
      <div className="mx-auto max-w-[820px] rounded-[18px] border border-black/[0.09] bg-white shadow-[0_12px_42px_rgba(22,28,23,0.07)] transition-shadow focus-within:shadow-[0_16px_48px_rgba(22,28,23,0.11)]">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={isRunning ? "Agent 正在运行…" : "给 Agent 发送消息"}
          disabled={isRunning || !sessionId}
          className="min-h-[62px] resize-none border-0 bg-transparent px-4 pb-1 pt-3.5 text-[12px] leading-5 shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
          <ComposerAction
            label="添加附件"
            icon={<Paperclip size={15} />}
            onClick={() => onPlaceholder("附件")}
          />
          <ComposerAction
            label="引用能力"
            icon={<AtSign size={15} />}
            onClick={() => onPlaceholder("能力引用")}
          />
          <ComposerAction
            label="运行选项"
            icon={<SlidersHorizontal size={14} />}
            onClick={() => onPlaceholder("运行选项")}
          />
          <span className="ml-auto mr-2 hidden text-[9px] text-[#a2a7a1] sm:block">
            Enter 发送 · Shift + Enter 换行
          </span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={isRunning || !text.trim() || !sessionId}
            aria-label="发送"
            className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#171b18] text-white transition hover:bg-[#2b302c] disabled:bg-[#d9dcd8] disabled:text-white"
          >
            <ArrowUp size={15} strokeWidth={2.3} />
          </button>
        </div>
      </div>
      <p className="mx-auto mt-2 max-w-[820px] text-center text-[9px] text-[#a3a8a2]">
        Agent 可能调用工具。执行结果会保存在当前 Session 中。
      </p>
    </div>
  );
}

function ComposerAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-lg text-[#8e948e] transition hover:bg-black/[0.045] hover:text-[#4f5650]"
    >
      {icon}
    </button>
  );
}
