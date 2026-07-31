import OpenAI from "openai";
import { env } from "@/lib/env";
import type { ChatTurn, WebSource } from "@/types/chat";

const KNOWLEDGE_MODEL = "gpt-4o-mini";

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.openaiApiKey });
  }
  return client;
}

const INSTRUCTIONS = `The user's own document library did not cover this question, so you are now
answering from general knowledge and, when useful, live web search — not from their documents.

- Answer helpfully and directly. Do not refuse just because it isn't in their documents; that's
  exactly why you're being asked here.
- Use web search for anything that benefits from current, factual, or verifiable information —
  recent events, specific tools/platforms/services, prices, statistics, or when the user asks for
  links. Ground those parts of the answer in what the search returns.
- Never claim or imply this came from the user's own documents — it did not.
- Write natural GitHub-flavored Markdown prose. Use a list only when the content is genuinely a
  list (e.g. the user asked for several platforms). No Markdown headings.`;

export interface KnowledgeAnswer {
  answer: string;
  mode: "general" | "web";
  webSources: WebSource[];
}

const FALLBACK_ANSWER = "I wasn't able to generate an answer. Please try again.";

/**
 * Answers a question the document library couldn't, using the model's general knowledge
 * plus OpenAI's built-in web search (Responses API `web_search` tool) when the question
 * benefits from live/verifiable info. `mode` is "web" when the answer actually cited web
 * results, "general" when it was answered from the model's own knowledge alone.
 */
export async function answerFromKnowledge(
  query: string,
  history: ChatTurn[] = [],
  onDelta?: (text: string) => void,
): Promise<KnowledgeAnswer> {
  const openai = getClient();

  const input = [
    ...history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user" as const, content: query },
  ];

  const stream = await openai.responses.create({
    model: KNOWLEDGE_MODEL,
    instructions: INSTRUCTIONS,
    tools: [{ type: "web_search" }],
    input,
    stream: true,
  });

  let answer = "";
  let usedWebSearch = false;
  const webSources: WebSource[] = [];
  const seenUrls = new Set<string>();

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      answer += event.delta;
      onDelta?.(event.delta);
    } else if (event.type === "response.output_text.annotation.added") {
      const annotation = event.annotation as { type?: string; url?: string; title?: string };
      if (annotation.type === "url_citation" && annotation.url && !seenUrls.has(annotation.url)) {
        seenUrls.add(annotation.url);
        webSources.push({ url: annotation.url, title: annotation.title || annotation.url });
      }
    } else if (event.type === "response.output_item.added" && event.item.type === "web_search_call") {
      // The tool can return data (e.g. weather) without formal url_citation annotations —
      // seeing the search call itself is what tells us the answer used live web data.
      usedWebSearch = true;
    }
  }

  return {
    answer: answer.trim() || FALLBACK_ANSWER,
    mode: usedWebSearch || webSources.length > 0 ? "web" : "general",
    webSources,
  };
}
