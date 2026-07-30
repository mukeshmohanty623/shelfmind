import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ChatSource } from "@/types/chat";

function formatSource(source: ChatSource): string {
  if (source.page) return `${source.filename} (page ${source.page})`;
  return source.filename;
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
      {message.sources && message.sources.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Sources: {message.sources.map(formatSource).join(" · ")}
        </p>
      )}
    </div>
  );
}
