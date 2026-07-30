import { analyzeQuery, condenseQuery, refineQuery } from "@/lib/rag/queryTransform";
import { retrieveContext, type RetrievedChunk } from "@/lib/rag/retrieve";
import { answerQuestion } from "@/lib/llm/answerQuestion";
import { evaluateAnswer } from "@/lib/llm/judgeAnswer";
import type { ChatTurn } from "@/types/chat";

const MAX_ATTEMPTS = 3;
const MIN_ACCEPTABLE_SCORE = 6;
const NO_CONTEXT_ANSWER = "I couldn't find anything about that in your documents.";

export interface AnswerWithRetryResult {
  answer: string;
  citedChunks: RetrievedChunk[];
  score: number;
  attempts: number;
}

export interface AnswerWithRetryCallbacks {
  /** A token chunk of the first attempt's answer, as it streams in. */
  onDelta?: (text: string) => void;
  /**
   * Attempts exhausted or a later attempt won out, and it wasn't the one streamed live
   * — caller should show `fullAnswer` as the final content in one shot.
   */
  onReplace?: (fullAnswer: string) => void;
}

/**
 * Retrieve → answer → evaluate, retrying with a reformulated search query when the
 * evaluation scores the answer below MIN_ACCEPTABLE_SCORE, up to MAX_ATTEMPTS.
 *
 * Only the first attempt streams live (`onDelta`) — retries run silently and, if one of
 * them wins, are delivered via `onReplace` in one shot instead of restreaming. Live-
 * streaming every retry meant the user visibly watched an answer get typed out, wiped,
 * and retyped up to 3 times before the final (sometimes still weak) answer landed — a
 * jarring "it's looping" experience for exactly the ambiguous/weakly-grounded queries
 * where retries actually fire. Silently retrying and swapping in the final result once
 * gives the same up-to-3-attempts self-correction without that flicker.
 *
 * Also: if retrieval comes back with zero chunks, the LLM is never called at all for
 * that attempt — asking it to answer from nothing is exactly how it ends up
 * substituting outside knowledge (e.g. recommending generic external websites/links
 * that were never in the user's documents) instead of admitting it has nothing. A
 * confident, deterministic decline is returned directly, which also short-circuits the
 * retry loop immediately (score 10) rather than burning attempts on a case retrying
 * can't fix.
 */
export async function answerWithRetry(
  query: string,
  history: ChatTurn[] = [],
  callbacks: AnswerWithRetryCallbacks = {},
): Promise<AnswerWithRetryResult> {
  const standaloneQuery = history.length > 0 ? await condenseQuery(query, history) : query;
  let searchQuery = standaloneQuery;
  let best: AnswerWithRetryResult | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const analysis = await analyzeQuery(searchQuery);
    const chunks = await retrieveContext(
      [searchQuery, analysis.hyde, analysis.stepBack, ...analysis.subQuestions],
      standaloneQuery,
    );

    let answer: string;
    let citedChunks: RetrievedChunk[];
    let score: number;

    if (chunks.length === 0) {
      answer = NO_CONTEXT_ANSWER;
      citedChunks = [];
      score = 10;
      if (attempt === 1) callbacks.onDelta?.(answer);
    } else {
      answer = await answerQuestion(query, chunks, history, attempt === 1 ? callbacks.onDelta : undefined);
      ({ score, citedChunks } = await evaluateAnswer(query, answer, chunks));
    }

    const result: AnswerWithRetryResult = { answer, citedChunks, score, attempts: attempt };
    if (!best || score > best.score) best = result;

    if (score >= MIN_ACCEPTABLE_SCORE) {
      if (best.attempts !== 1) callbacks.onReplace?.(best.answer);
      return best;
    }

    if (attempt < MAX_ATTEMPTS) {
      searchQuery = await refineQuery(standaloneQuery, answer);
    }
  }

  if (best!.attempts !== 1) {
    callbacks.onReplace?.(best!.answer);
  }
  return best!;
}
