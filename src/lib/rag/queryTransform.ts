import OpenAI from "openai";
import { env } from "@/lib/env";
import type { ChatTurn } from "@/types/chat";

const QUERY_TRANSFORM_MODEL = "gpt-4o-mini";

export interface QueryAnalysis {
  hyde: string;
  stepBack: string;
  subQuestions: string[];
}

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.openaiApiKey });
  }
  return client;
}

const SYSTEM_PROMPT = `You expand a user's question into retrieval variants for a RAG search
over a personal document library. Given the question, respond with ONLY a JSON object
(no markdown fences, no prose) with exactly these keys:

- "hyde": a short hypothetical passage (100-150 words) written as if it were an excerpt
  from a document that directly answers the question. Write it in a neutral, factual,
  document-like register — not as an answer addressed to the user.
- "stepBack": one broader, more general question that captures the underlying concept
  behind the user's question.
- "subQuestions": an array of 2-3 focused sub-questions that decompose the user's
  question into narrower parts.

Example:
User question: "What's the gas limit change in the London hard fork?"
{"hyde":"The London hard fork introduced EIP-1559, which replaced the first-price auction fee model with a base fee that is burned and a priority fee paid to validators. It also adjusted the block gas limit mechanism, allowing blocks to elastically expand up to twice the target size...","stepBack":"What protocol changes did the London hard fork introduce to Ethereum's fee and gas mechanisms?","subQuestions":["What is EIP-1559?","How does the base fee mechanism work?","What is the block gas limit before and after London?"]}`;

export async function analyzeQuery(query: string): Promise<QueryAnalysis> {
  const fallback: QueryAnalysis = { hyde: query, stepBack: query, subQuestions: [] };

  try {
    const openai = getClient();
    const response = await openai.chat.completions.create({
      model: QUERY_TRANSFORM_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
      temperature: 0,
      seed: 42,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message.content;
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<QueryAnalysis>;
    return {
      hyde: typeof parsed.hyde === "string" && parsed.hyde.trim() ? parsed.hyde : fallback.hyde,
      stepBack:
        typeof parsed.stepBack === "string" && parsed.stepBack.trim()
          ? parsed.stepBack
          : fallback.stepBack,
      subQuestions: Array.isArray(parsed.subQuestions)
        ? parsed.subQuestions.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
        : fallback.subQuestions,
    };
  } catch {
    return fallback;
  }
}

const REFINE_SYSTEM_PROMPT = `A RAG search over a personal document library returned a weak
answer to a user's question. Propose one alternate phrasing of the search query that might
retrieve better-matching passages — try different wording, synonyms, or a different angle on the
same underlying question. Do not change what's being asked.

Respond with ONLY a JSON object: {"query": "..."}`;

/** Reformulates a query after a weak-scoring retrieval attempt, for the next retry. */
export async function refineQuery(query: string, weakAnswer: string): Promise<string> {
  try {
    const openai = getClient();
    const response = await openai.chat.completions.create({
      model: QUERY_TRANSFORM_MODEL,
      messages: [
        { role: "system", content: REFINE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Original question: ${query}\n\nWeak answer produced: ${weakAnswer}`,
        },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message.content;
    if (!raw) return query;

    const parsed = JSON.parse(raw) as Partial<{ query: string }>;
    return typeof parsed.query === "string" && parsed.query.trim() ? parsed.query : query;
  } catch {
    return query;
  }
}

const CONDENSE_SYSTEM_PROMPT = `Given a conversation history and the latest user message, rewrite
the latest message into a fully standalone question that makes sense without the history —
resolve pronouns, ellipsis, and implicit references ("that", "it", "the second one", "what about
...") using the history. If the latest message is already standalone, return it unchanged. Do not
answer the question, and do not add information the user didn't ask for.

Respond with ONLY a JSON object: {"query": "..."}`;

function formatHistory(history: ChatTurn[]): string {
  return history.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`).join("\n");
}

/** Rewrites the current message into a standalone, reference-resolved query for retrieval. */
export async function condenseQuery(query: string, history: ChatTurn[]): Promise<string> {
  try {
    const openai = getClient();
    const response = await openai.chat.completions.create({
      model: QUERY_TRANSFORM_MODEL,
      messages: [
        { role: "system", content: CONDENSE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Conversation history:\n${formatHistory(history)}\n\nLatest message: ${query}`,
        },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message.content;
    if (!raw) return query;

    const parsed = JSON.parse(raw) as Partial<{ query: string }>;
    return typeof parsed.query === "string" && parsed.query.trim() ? parsed.query : query;
  } catch {
    return query;
  }
}
