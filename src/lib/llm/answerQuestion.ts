import OpenAI from "openai";
import { env } from "@/lib/env";
import type { RetrievedChunk } from "@/lib/rag/retrieve";
import type { ChatTurn } from "@/types/chat";

type ChatCompletionMessageParam = OpenAI.Chat.ChatCompletionMessageParam;

const ANSWER_MODEL = "gpt-4o-mini";

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.openaiApiKey });
  }
  return client;
}

const SYSTEM_PROMPT = `You are the answering engine for a personal research library. You are given
a user's question and numbered excerpts retrieved from their own documents.

Before writing anything, silently work through: which excerpts (if any) actually address the
question, what they say, and whether they're sufficient to answer confidently. Do not show this
analysis — output only the final answer.

Rules:
- Answer strictly using the provided excerpts. Never use outside knowledge to fill gaps —
  this includes recommending external websites/tools/platforms, giving generic advice, or
  supplying links/facts that aren't literally in the excerpts, even if they'd be genuinely
  useful or the conversation history makes it feel like a natural next thing to offer.
- If the excerpts don't contain the answer, say so plainly instead of guessing or being
  "helpful" with general knowledge. A confident "I don't have that in your documents" is
  always the right answer when the excerpts don't cover it — never substitute your own
  knowledge to avoid saying that, and never invent specifics (names, numbers, URLs) that
  aren't in the excerpts.
- Prior turns in the conversation are for understanding what "it"/"that"/"the second one"
  refers to — not license to keep elaborating on something once the excerpts run out. If an
  earlier answer covered a topic but the current excerpts don't address this follow-up,
  decline this one too.
- Be direct. Do not restate the question, do not pad with filler.
- Do not fabricate a "Sources" section or cite excerpt numbers inline — the caller identifies and
  renders sources separately.
- Write GitHub-flavored Markdown, but default to natural, flowing prose paragraphs — like a
  knowledgeable person answering conversationally, not a report. The excerpts themselves may be
  bulleted (e.g. a resume) — that doesn't mean your answer should be. Reach for structure only
  when it genuinely earns its keep:
  - A numbered/bulleted list only when the question explicitly asks for steps/a list, or the
    answer has several genuinely parallel items that would be hard to follow as a sentence.
  - A table only when comparing multiple items across multiple attributes.
  - Bold/inline code sparingly, for names of things, not as a formatting habit.
  - Never use Markdown headings in a chat answer — it's a conversation, not a document.
  When in doubt, prefer prose.`;

const FEW_SHOT: ChatCompletionMessageParam[] = [
  {
    role: "user",
    content:
      'Question: What database does the indexing pipeline use for vectors?\n\nContext:\n[1] (from "architecture.pdf"): The system stores chunk embeddings in Qdrant, a vector database, using cosine similarity over 1536-dimension vectors produced by OpenAI\'s text-embedding-3-small model.',
  },
  {
    role: "assistant",
    content:
      "The indexing pipeline stores its embeddings in **Qdrant**, a vector database. It uses cosine similarity over 1536-dimension vectors produced by OpenAI's `text-embedding-3-small` model.",
  },
  {
    role: "user",
    content:
      'Question: tell me about my last role\n\nContext:\n[1] (from "resume.pdf", page 1): Senior Engineer at Acme Corp, Jan 2022 - Present.\n- Led the payments team\n- Shipped a new checkout flow\n- Mentored two junior engineers',
  },
  {
    role: "assistant",
    content:
      "You've been a Senior Engineer at Acme Corp since January 2022, leading the payments team. In that role you shipped a new checkout flow and have been mentoring two junior engineers.",
  },
  {
    role: "user",
    content:
      'Question: what steps do I need to deploy this?\n\nContext:\n[1] (from "runbook.md"): Deployment requires: building the image, pushing to the registry, then running the migration before restarting the service.',
  },
  {
    role: "assistant",
    content:
      "1. Build the image\n2. Push it to the registry\n3. Run the migration\n4. Restart the service",
  },
  {
    role: "user",
    content:
      'Question: What is the pricing model for the enterprise tier?\n\nContext:\n[1] (from "product-overview.pdf"): The product ships in two tiers: Free, limited to 3 projects, and Pro, which unlocks unlimited projects and priority support.',
  },
  {
    role: "assistant",
    content:
      "The provided excerpts don't mention an enterprise tier or its pricing — only Free and Pro tiers are described. I can't answer this from your documents.",
  },
  {
    role: "user",
    content:
      'Question: Where can she apply for new jobs — suggest some good platforms\n\nContext:\n[1] (from "appointment-letter.pdf", page 1): Appointment letter for Jane Doe, Senior Analyst role, signed May 3, 2024.',
  },
  {
    role: "assistant",
    content:
      "Your documents don't contain any job platforms, career sites, or similar recommendations — this excerpt is just Jane's appointment letter. I can't suggest platforms from what's in your library.",
  },
];

function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const location = chunk.page ? `, page ${chunk.page}` : "";
      return `[${i + 1}] (from "${chunk.filename}"${location}): ${chunk.text}`;
    })
    .join("\n\n");
}

const FALLBACK_ANSWER = "I wasn't able to generate an answer. Please try again.";

/**
 * Streams a grounded Markdown answer, invoking `onDelta` with each token chunk as it
 * arrives. Citation identification happens separately (see judgeAnswer.evaluateAnswer) —
 * the model isn't asked to embed "[N]" markers here since that proved unreliable for
 * confident, single-source answers, and doing so would clutter the streamed prose anyway.
 */
export async function answerQuestion(
  query: string,
  chunks: RetrievedChunk[],
  history: ChatTurn[] = [],
  onDelta?: (text: string) => void,
): Promise<string> {
  const openai = getClient();

  const context =
    chunks.length > 0
      ? formatContext(chunks)
      : "(No relevant excerpts were found in the user's documents.)";

  const historyMessages: ChatCompletionMessageParam[] = history.map((turn) => ({
    role: turn.role,
    content: turn.text,
  }));

  const stream = await openai.chat.completions.create({
    model: ANSWER_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...FEW_SHOT,
      ...historyMessages,
      { role: "user", content: `Question: ${query}\n\nContext:\n${context}` },
    ],
    temperature: 0.2,
    stream: true,
  });

  let answer = "";
  for await (const part of stream) {
    const delta = part.choices[0]?.delta?.content;
    if (delta) {
      answer += delta;
      onDelta?.(delta);
    }
  }

  return answer.trim() || FALLBACK_ANSWER;
}
