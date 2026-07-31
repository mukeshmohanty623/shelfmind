import OpenAI from "openai";
import { env } from "@/lib/env";
import type { RetrievedChunk } from "@/lib/rag/retrieve";
import type { ChatTurn } from "@/types/chat";

const JUDGE_MODEL = "gpt-4o-mini";

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.openaiApiKey });
  }
  return client;
}

const SYSTEM_PROMPT = `You grade one answer produced by a RAG system against the question it was
asked and the excerpts it had available.

"answered" is a boolean: true ONLY if the answer directly and confidently answers the user's
actual question using the excerpts. Set it FALSE if the answer declines, says it can't answer,
hedges ("I can't provide a definitive suggestion", "the documents don't explicitly state..."),
only mentions excerpt content tangentially without actually answering what was asked, or punts.
A correct, confident "that isn't in your documents" decline is answered=FALSE (it's an honest
non-answer — good behavior, but it did not answer the question).

Also set answered=FALSE when the question asks for a RECOMMENDATION, SUGGESTION, OPINION, or advice
about what to do (e.g. "suggest a job portal she can apply on", "which tool should I use", "where
should she look") and the answer only works by REPURPOSING an incidental mention from the excerpts
into that recommendation — e.g. the excerpts list "Naukri / LinkedIn Recruiter" as tools the person
USED in a past job, and the answer recasts those as portals they SHOULD now apply on. The excerpts
describing something is not the same as the excerpts recommending it; that kind of stretch is not a
real answer to a request for a recommendation.

Score 0-10 on how well the answer addresses the question using only those excerpts. A correct
decline scores high (8-10) even though answered=false. Score low when the answer is evasive
despite relevant excerpts being available, unsupported, or contradicts the excerpts.

Score 0-2 (not just "low") if the answer states any specific fact, name, number, URL,
recommendation, or suggestion not actually present in the excerpts — e.g. recommending external
websites/tools/platforms, or elaborating on something from earlier conversation turns the current
excerpts don't support. That's a fabrication regardless of how plausible or helpful it sounds.

"usedExcerpts" is the list of excerpt numbers (the "[N]" labels) whose content the answer actually
draws on — only the ones genuinely reflected in the answer's claims. Empty if none.

Respond with ONLY a JSON object matching the given schema.`;

interface EvaluationSchema {
  answered: boolean;
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
        answered: { type: "boolean" },
        score: { type: "integer" },
        usedExcerpts: { type: "array", items: { type: "integer" } },
      },
      required: ["answered", "score", "usedExcerpts"],
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

function formatHistory(history: ChatTurn[]): string {
  if (history.length === 0) return "";
  const turns = history
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`)
    .join("\n");
  return `Conversation so far (for resolving references like "those"/"it" in the question):\n${turns}\n\n`;
}

export interface AnswerEvaluation {
  answered: boolean;
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
  history: ChatTurn[] = [],
): Promise<AnswerEvaluation> {
  try {
    const openai = getClient();
    const response = await openai.chat.completions.create({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `${formatHistory(history)}Question: ${query}\n\nExcerpts:\n${formatExcerpts(chunks)}\n\nAnswer: ${answer}`,
        },
      ],
      temperature: 0,
      response_format: RESPONSE_SCHEMA,
    });

    const raw = response.choices[0]?.message.content;
    if (!raw) return { answered: false, score: 10, citedChunks: [] };

    const parsed = JSON.parse(raw) as EvaluationSchema;
    const score = Math.max(0, Math.min(10, Math.round(parsed.score)));
    const citedChunks = parsed.usedExcerpts
      .map((n) => chunks[n - 1])
      .filter((chunk): chunk is RetrievedChunk => chunk !== undefined);

    return { answered: parsed.answered === true, score, citedChunks };
  } catch {
    // A judge failure shouldn't block a document answer that was already generated from
    // real excerpts — treat it as a pass (answered) so an unrelated API hiccup doesn't
    // needlessly bounce the user to the general/web fallback.
    return { answered: true, score: 10, citedChunks: [] };
  }
}
