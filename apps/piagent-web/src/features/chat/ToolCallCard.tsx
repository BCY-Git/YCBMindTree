import { cn } from "@/lib/utils";
import { Check, ChevronDown, LoaderCircle, TerminalSquare, X } from "lucide-react";
import type { UiToolCall } from "@/store/sessionStore";

/**
 * 工具调用卡片。第一步先做出基本形态，
 * 第二步再打磨样式（转圈动画、成功/失败配色等）。
 */
export function ToolCallCard({ tool }: { tool: UiToolCall }) {
  return (
    <details className="group mt-3 overflow-hidden rounded-xl border border-black/[0.075] bg-white/65 text-left">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#eef1eb] text-[#687268]">
          <TerminalSquare size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] font-semibold text-[#424943]">
            {tool.name}
          </span>
          <span className="mt-0.5 block text-[9px] text-[#9aa09a]">Tool call</span>
        </span>
        <span
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-medium",
            tool.status === "running" && "bg-[#f4efd9] text-[#8a7431]",
            tool.status === "done" && "bg-[#e8f3e8] text-[#4f7e57]",
            tool.status === "error" && "bg-[#f4e5e2] text-[#9a5046]",
          )}
        >
          {tool.status === "running" ? (
            <LoaderCircle size={9} className="animate-spin" />
          ) : tool.status === "done" ? (
            <Check size={9} />
          ) : (
            <X size={9} />
          )}
          {tool.status === "running" ? "调用中" : tool.status === "done" ? "已完成" : "出错"}
        </span>
        <ChevronDown
          size={13}
          className="text-[#a2a7a1] transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-black/[0.06] bg-[#f7f8f5] px-3 py-3">
        <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#a0a59f]">
          Arguments
        </div>
        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-5 text-[#606760]">
          {JSON.stringify(tool.args, null, 2)}
        </pre>
        {tool.result && (
          <>
            <div className="mt-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#a0a59f]">
              Result
            </div>
            <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-5 text-[#606760]">
              {tool.result}
            </pre>
          </>
        )}
      </div>
    </details>
  );
}
