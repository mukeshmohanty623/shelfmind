"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessageView } from "@/components/chat/ChatMessageView";
import { ChatInput } from "@/components/chat/ChatInput";
import type { ChatAssistantMessage, ChatMessage, ChatTurn } from "@/types/chat";
import type { Resource } from "@/types/resource";

const MAX_HISTORY_MESSAGES = 6;

const THINKING_LABELS = ["Thinking...", "Researching...", "Reading your sources..."];

function updateMessage(
  messages: ChatMessage[],
  id: string,
  updater: (message: ChatAssistantMessage) => ChatAssistantMessage,
): ChatMessage[] {
  return messages.map((message) =>
    message.id === id && message.role === "assistant" ? updater(message) : message,
  );
}

function buildHistory(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .filter((m) => m.text.trim().length > 0)
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, text: m.text }));
}

async function streamChatResponse(
  query: string,
  history: ChatTurn[],
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, history }),
  });
  if (!res.ok || !res.body) throw new Error("chat request failed");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const raw of events) {
      const eventLine = raw.split("\n").find((line) => line.startsWith("event: "));
      const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
      if (!eventLine || !dataLine) continue;

      const event = eventLine.slice("event: ".length);
      const data = JSON.parse(dataLine.slice("data: ".length));

      if (event === "delta") {
        setMessages((prev) =>
          updateMessage(prev, assistantId, (m) => ({ ...m, text: m.text + data.text })),
        );
      } else if (event === "sources") {
        setMessages((prev) =>
          updateMessage(prev, assistantId, (m) => ({
            ...m,
            mode: data.mode,
            sources: data.sources,
            webSources: data.webSources,
          })),
        );
      } else if (event === "error") {
        setMessages((prev) =>
          updateMessage(prev, assistantId, (m) => ({
            ...m,
            text: "Something went wrong answering that — please try again.",
          })),
        );
      }
    }
  }

  setMessages((prev) => updateMessage(prev, assistantId, (m) => ({ ...m, isStreaming: false })));
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sourceCount, setSourceCount] = useState(0);
  const [thinkingLabel, setThinkingLabel] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/resources")
      .then((res) => res.json())
      .then((data: { resources: Resource[] }) => setSourceCount(data.resources.length))
      .catch(() => setSourceCount(0));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinkingLabel]);

  async function handleSend(text: string) {
    const history = buildHistory(messages);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };
    const assistantId = crypto.randomUUID();
    const assistantMessage: ChatAssistantMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      isStreaming: true,
    };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    const label = THINKING_LABELS[Math.floor(Math.random() * THINKING_LABELS.length)];
    setThinkingLabel(label);

    try {
      await streamChatResponse(text, history, assistantId, setMessages);
    } catch {
      setMessages((prev) =>
        updateMessage(prev, assistantId, (m) => ({
          ...m,
          text: "Something went wrong answering that — please try again.",
          isStreaming: false,
        })),
      );
    } finally {
      setThinkingLabel(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center border-b border-border px-5 py-3">
        <h2 className="font-heading text-xl font-semibold">Chat</h2>
      </div>

      <div className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-8 px-5 py-6">
            {messages.map((message) => (
              <ChatMessageView key={message.id} message={message} />
            ))}
            {(() => {
              const last = messages[messages.length - 1];
              const waitingForFirstToken =
                thinkingLabel && last?.role === "assistant" && last.text === "";
              return (
                waitingForFirstToken && (
                  <span className="shimmer-text text-base font-medium">{thinkingLabel}</span>
                )
              );
            })()}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </div>

      <div className="shrink-0 p-4">
        <ChatInput
          onSend={handleSend}
          sourceCount={sourceCount}
          isSending={thinkingLabel !== null}
        />
      </div>
    </div>
  );
}
