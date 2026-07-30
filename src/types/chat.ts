import type { ResourceSourceType } from "@/types/resource";

export interface ChatUserMessage {
  id: string;
  role: "user";
  text: string;
}

export interface ChatSource {
  resourceId: string;
  filename: string;
  sourceType: ResourceSourceType;
  sourceUrl?: string;
  page?: number;
  chunkIndex: number;
}

export interface ChatAssistantMessage {
  id: string;
  role: "assistant";
  /** Markdown, appended to incrementally while streaming. */
  text: string;
  isStreaming?: boolean;
  sources?: ChatSource[];
}

export type ChatMessage = ChatUserMessage | ChatAssistantMessage;

/** Wire format for prior turns sent to the chat API — plain text only, no ids/sources/streaming flags. */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}
