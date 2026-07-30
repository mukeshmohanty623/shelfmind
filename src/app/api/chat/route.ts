import { NextRequest } from "next/server";
import { answerWithRetry } from "@/lib/rag/answerWithRetry";
import type { ChatSource, ChatTurn } from "@/types/chat";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

const MAX_HISTORY_MESSAGES = 6;

function toSources(chunks: RetrievedChunk[]): ChatSource[] {
  return chunks.map((chunk) => ({
    resourceId: chunk.resourceId,
    filename: chunk.filename,
    sourceType: chunk.sourceType,
    sourceUrl: chunk.sourceUrl,
    page: chunk.page,
    chunkIndex: chunk.chunkIndex,
  }));
}

function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (turn): turn is ChatTurn =>
        typeof turn === "object" &&
        turn !== null &&
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.text === "string" &&
        turn.text.trim().length > 0,
    )
    .map((turn) => ({ role: turn.role, text: turn.text.trim() }))
    .slice(-MAX_HISTORY_MESSAGES);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const history = parseHistory(body?.history);

  if (!query) {
    return new Response(JSON.stringify({ error: "query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const result = await answerWithRetry(query, history, {
          onDelta: (text) => send("delta", { text }),
          onReplace: (fullAnswer) => send("replace", { text: fullAnswer }),
        });

        send("sources", { sources: toSources(result.citedChunks) });
        send("done", {});
      } catch (err) {
        console.error("chat query failed", err);
        send("error", { message: "Failed to answer query" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
