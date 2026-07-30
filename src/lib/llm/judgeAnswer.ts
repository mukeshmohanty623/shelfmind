import OpenAI from "openai";
import { env } from "@/lib/env";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

const JUDGE_MODEL = "gpt-4o-mini";

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.openaiApiKey });
  }
  return client;
}

const SYSTEM_PROMPT = `You grade one answer produced by a RAG system against the question it was
asked and the excerpts it had available, and identify which excerpts it actually drew on.

Score 0-10 on how well the answer actually addresses the question using only those excerpts.
A confident, correct "the documents don't cover this" is a GOOD answer when the excerpts really
don't address the question — score it high (8-10), not low. Only score low when the answer is
vague, evasive despite relevant excerpts being available, unsupported by the excerpts, or
contradicts them.

Score 0-2 (not just "low") if the answer states any specific fact, name, number, URL,
recommendation, or suggestion that is not actually present in the excerpts — e.g. recommending
external websites/tools/platforms, or continuing to elaborate on something from earlier
conversation turns that the current excerpts don't support. That's a fabrication, not a partial
answer, regardless of how plausible or helpful it sounds.

"usedExcerpts" is the list of excerpt numbers (the "[N]" labels) whose content the answer actually
draws on — not every excerpt shown to you, only the ones genuinely reflected in the answer's
claims. Empty if the answer couldn't be grounded in any of them.

Respond with ONLY a JSON object matching the given schema.`;

interface EvaluationSchema {
  score: number;
  usedExcerpts: number[];
}

const RESPONSE_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "answer_evaluation",
    strict: true,
    schema: {
      type: "object",
      properties: {
        score: { type: "integer" },
        usedExcerpts: { type: "array", items: { type: "integer" } },
      },
      required: ["score", "usedExcerpts"],
      additionalProperties: false,
    },
  },
};

function formatExcerpts(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "(none retrieved)";
  return chunks
    .map((chunk, i) => `[${i + 1}] (from "${chunk.filename}"): ${chunk.text}`)
    .join("\n\n");
}

export interface AnswerEvaluation {
  score: number;
  citedChunks: RetrievedChunk[];
}

/**
 * Grades an answer 0-10 against its question and source excerpts, and identifies which
 * excerpts it actually drew on — in one structured-output call. Citation extraction lives
 * here rather than in answerQuestion's prompt because asking the model to reliably embed
 * "[N]" markers inline in free-flowing streamed prose proved unreliable (it often omits
 * them entirely for confident, single-source answers); a separate deterministic
 * structured-output call is accurate regardless of how the streamed prose reads.
 */
export async function evaluateAnswer(
  query: string,
  answer: string,
  chunks: RetrievedChunk[],
): Promise<AnswerEvaluation> {
  try {
    const openai = getClient();
    const response = await openai.chat.completions.create({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Question: ${query}\n\nExcerpts:\n${formatExcerpts(chunks)}\n\nAnswer: ${answer}`,
        },
      ],
      temperature: 0,
      response_format: RESPONSE_SCHEMA,
    });

    const raw = response.choices[0]?.message.content;
    if (!raw) return { score: 10, citedChunks: [] };

    const parsed = JSON.parse(raw) as EvaluationSchema;
    const score = Math.max(0, Math.min(10, Math.round(parsed.score)));
    const citedChunks = parsed.usedExcerpts
      .map((n) => chunks[n - 1])
      .filter((chunk): chunk is RetrievedChunk => chunk !== undefined);

    return { score, citedChunks };
  } catch {
    // A judge failure shouldn't block the answer from reaching the user — treat it as a
    // pass so the retry loop doesn't burn attempts on an unrelated API hiccup.
    return { score: 10, citedChunks: [] };
  }
}
