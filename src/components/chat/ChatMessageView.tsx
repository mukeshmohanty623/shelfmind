import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Globe, Sparkles } from "lucide-react";
import type { ChatMessage, ChatSource } from "@/types/chat";

function formatSource(source: ChatSource): string {
  if (source.page) return `${source.filename} (page ${source.page})`;
  return source.filename;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Provenance({ message }: { message: Extract<ChatMessage, { role: "assistant" }> }) {
  if (message.isStreaming) return null;

  if (message.mode === "web") {
    return (
      <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Globe className="size-3.5" /> From the web · not in your documents
        </span>
        {message.webSources && message.webSources.length > 0 && (
          <ul className="flex flex-col gap-1">
            {message.webSources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  {source.title || hostname(source.url)}
                </a>{" "}
                <span className="text-xs opacity-70">({hostname(source.url)})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (message.mode === "general") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Sparkles className="size-3.5" /> General knowledge · not in your documents
      </span>
    );
  }

  if (message.sources && message.sources.length > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <BookOpen className="size-3.5" /> Sources: {message.sources.map(formatSource).join(" · ")}
      </span>
    );
  }

  return null;
}

export function ChatMessageView({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-secondary px-4 py-3 text-base text-secondary-foreground">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="markdown-answer prose prose-base max-w-none text-base leading-relaxed prose-headings:font-heading prose-pre:bg-secondary prose-pre:text-secondary-foreground">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
        {message.isStreaming && (
          <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-foreground/70" />
        )}
      </div>
      <Provenance message={message} />
    </div>
  );
}
