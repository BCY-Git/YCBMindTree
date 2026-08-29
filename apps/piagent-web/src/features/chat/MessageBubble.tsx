import { cn } from "@/lib/utils";
import { Bot, UserRound } from "lucide-react";
import type { UiMessage } from "@/store/sessionStore";
import { ToolCallCard } from "./ToolCallCard";

export function MessageBubble({ message }: { message: UiMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "message-enter flex gap-3 border-b border-black/[0.055] py-6",
        isUser && "flex-row-reverse",
      )}
    >
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-[10px]",
          isUser
            ? "bg-[#e1e5df] text-[#687068]"
            : "bg-[#171b18] text-[#d7ff62]",
        )}
      >
        {isUser ? <UserRound size={14} /> : <Bot size={15} />}
      </span>
      <div className={cn("min-w-0 max-w-[78%]", isUser && "text-right")}>
        <div
          className={cn(
            "mb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#a0a59f]",
            isUser && "text-right",
          )}
        >
          {isUser ? "You" : "Pi Agent"}
        </div>
        {message.content && (
          <p
            className={cn(
              "whitespace-pre-wrap text-[12.5px] leading-6 text-[#343a35]",
              isUser &&
                "inline-block rounded-[14px] rounded-tr-[4px] bg-[#e9ebe7] px-4 py-2.5 text-left",
            )}
          >
            {message.content}
          </p>
        )}
        <div className="text-left">
          {message.toolCalls?.map((toolCall) => (
            <ToolCallCard key={toolCall.id} tool={toolCall} />
          ))}
        </div>
      </div>
    </div>
  );
}
