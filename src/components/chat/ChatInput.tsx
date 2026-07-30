"use client";

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ArrowRightIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

const MIN_ROWS = 3;
const MAX_ROWS = 12;
const LINE_HEIGHT_PX = 26; // text-base + leading-relaxed
const MAX_HEIGHT_PX = LINE_HEIGHT_PX * MAX_ROWS;

export function ChatInput({
  onSend,
  sourceCount,
  isSending = false,
}: {
  onSend: (text: string) => void | Promise<void>;
  sourceCount: number;
  isSending?: boolean;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    autoResize(e.target);
  }

  function handleSubmit() {
    if (isSending) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
    const el = textareaRef.current;
    if (el) {
      el.value = "";
      autoResize(el);
      el.focus();
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex items-end gap-3 rounded-2xl border border-border bg-background px-4 py-3">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={MIN_ROWS}
        disabled={isSending}
        placeholder="Start typing..."
        className="flex-1 resize-none overflow-y-hidden bg-transparent text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
      />
      <span className="shrink-0 pb-1.5 text-sm whitespace-nowrap text-muted-foreground">
        {sourceCount} source{sourceCount === 1 ? "" : "s"}
      </span>
      <Button
        size="icon"
        aria-label={isSending ? "Sending message" : "Send message"}
        disabled={!value.trim() || isSending}
        onClick={handleSubmit}
        className="shrink-0 rounded-full"
      >
        {isSending ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
      </Button>
    </div>
  );
}
