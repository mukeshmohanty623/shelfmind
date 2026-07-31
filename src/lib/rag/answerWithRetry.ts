import { analyzeQuery, condenseQuery, refineQuery } from "@/lib/rag/queryTransform";
import { retrieveContext, type RetrievedChunk } from "@/lib/rag/retrieve";
import { answerQuestion } from "@/lib/llm/answerQuestion";
import { evaluateAnswer } from "@/lib/llm/judgeAnswer";
import { answerFromKnowledge } from "@/lib/llm/answerFromKnowledge";
import type { AnswerMode, ChatTurn, WebSource } from "@/types/chat";

const MAX_DOC_ATTEMPTS = 2;
const MIN_ACCEPTABLE_SCORE = 6;

const REPLAY_BATCH_WORDS = 3;
const REPLAY_DELAY_MS = 12;

export interface AnswerWithRetryResult {
  answer: string;
  mode: AnswerMode;
  citedChunks: RetrievedChunk[];
  webSources: WebSource[];
}

export interface AnswerWithRetryCallbacks {
  /** Token chunks of the final answer, as it streams to the caller. */
  onDelta?: (text: string) => void;
}

/**
 * Replays already-generated text through `onDelta` in small chunks so a document answer
 * still reads as "typing" rather than appearing all at once. Document answers must be
 * generated and judged in full before we commit to them (see below), so they can't stream
 * live the way the fallback does — this reproduces the streaming feel without it.
 */
async function replay(text: string, onDelta?: (text: string) => void): Promise<void> {
  if (!onDelta) return;
  const tokens = text.match(/\S+\s*/g) ?? [text];
  for (let i = 0; i < tokens.length; i += REPLAY_BATCH_WORDS) {
    onDelta(tokens.slice(i, i + REPLAY_BATCH_WORDS).join(""));
    await new Promise((resolve) => setTimeout(resolve, REPLAY_DELAY_MS));
  }
}

/**
 * Tiered answering: try the user's documents first, and only if they don't cover the
 * question fall back to general knowledge + web search.
 *
 * 1. Documents (up to MAX_DOC_ATTEMPTS, refining the search query between tries): a
 *    grounded answer is generated *silently* and judged (`evaluateAnswer`) before anything
 *    is shown. It counts as a real document answer only if the judge says it actually
 *    `answered` the question, cited excerpts, and scored well — a decline, a hedge, or an
 *    answer that only repurposes an incidental mention does not qualify and falls through.
 * 2. Fallback (answerFromKnowledge): general knowledge + OpenAI web search, clearly
 *    labeled via `mode`.
 *
 * Only the answer that actually wins is ever streamed to the caller — a winning document
 * answer is replayed via `replay`, the fallback streams live. Nothing is streamed and
 * then replaced, so the user never sees a losing answer get swapped out mid-view.
 */
export async function answerWithRetry(
  query: string,
  history: ChatTurn[] = [],
  userId: string,
  callbacks: AnswerWithRetryCallbacks = {},
): Promise<AnswerWithRetryResult> {
  const standaloneQuery = history.length > 0 ? await condenseQuery(query, history) : query;
  let searchQuery = standaloneQuery;

  for (let attempt = 1; attempt <= MAX_DOC_ATTEMPTS; attempt++) {
    const analysis = await analyzeQuery(searchQuery);
    const chunks = await retrieveContext(
      [searchQuery, analysis.hyde, analysis.stepBack, ...analysis.subQuestions],
      standaloneQuery,
      userId,
    );

    if (chunks.length === 0) {
      if (attempt < MAX_DOC_ATTEMPTS) {
        searchQuery = await refineQuery(standaloneQuery, "No matching documents were found.");
        continue;
      }
      break;
    }

    const answer = await answerQuestion(query, chunks, history);
    const { answered, score, citedChunks } = await evaluateAnswer(query, answer, chunks, history);

    if (answered && citedChunks.length > 0 && score >= MIN_ACCEPTABLE_SCORE) {
      await replay(answer, callbacks.onDelta);
      return { answer, mode: "documents", citedChunks, webSources: [] };
    }

    if (attempt < MAX_DOC_ATTEMPTS) {
      searchQuery = await refineQuery(standaloneQuery, answer);
    }
  }

  const fallback = await answerFromKnowledge(query, history, callbacks.onDelta);
  return {
    answer: fallback.answer,
    mode: fallback.mode,
    citedChunks: [],
    webSources: fallback.webSources,
  };
}
