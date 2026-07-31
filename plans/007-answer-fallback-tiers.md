# Tiered Answering: Documents → General Knowledge → Web

**Status:** done — implemented and live-verified against the running stack.

## Context
Until now the chat assistant answered *strictly* from the user's indexed documents and
refused everything else (a deliberately hardened behavior — see `plans/006`'s
hallucination fix). A user hit the wall of that: after asking about an uploaded
appointment letter, they asked "suggest where Preeti can apply for jobs, list some
platforms" and got a flat refusal, then "ignore library, use your knowledge" — still
refused. They asked for documents to stay the **first priority**, but for questions the
documents don't cover, to allow answers from the model's general knowledge and from a
**web tool**, clearly distinguished from document-grounded answers.

Decisions made with the user up front (via AskUserQuestion):
- **Fallback tiers**: documents → general knowledge → web search (full 3-tier).
- **Web provider**: use OpenAI's built-in web search (Responses API `web_search` tool)
  rather than a new provider — the account already has an `OPENAI_API_KEY` and no other
  search key exists, so this adds the capability with zero new credentials/signup.
- **Provenance**: a distinct per-answer badge, not just a sentence — grounded answers
  keep `Sources: file.pdf (page N)`; general-knowledge answers show a "General knowledge
  · not in your documents" badge; web answers show a "From the web" badge plus the web
  links used.

Important framing: this does **not** loosen the anti-hallucination work from `plans/006`.
The strict grounded answerer (`answerQuestion`) stays strict — it still never invents
document content. The fallback is a *separate* function on a *separate*, clearly-labeled
tier; the documents tier simply routes to it instead of declining when the documents
genuinely don't cover the question.

## Architecture / Flow
Orchestrated in `src/lib/rag/answerWithRetry.ts` (restructured from the old
retry-only loop):

1. **Documents tier** (up to `MAX_DOC_ATTEMPTS = 2`, refining the search query between
   tries via the existing `refineQuery`): retrieve → grounded `answerQuestion` →
   `evaluateAnswer`. A grounded answer counts as a *real* document answer only if
   `evaluateAnswer` reports `answered === true` AND it cited excerpts AND scored
   `>= MIN_ACCEPTABLE_SCORE`. Zero-chunk retrievals skip the LLM entirely and go straight
   to the fallback.

   **The `answered` signal (added after two rounds of this getting it wrong).** The first
   version keyed documents-tier success on `citedChunks.length > 0`, reasoning that a
   "not in your documents" decline cites nothing. That held for pure declines but broke on
   two subtler shapes, both reported live:
   - A *hedge* that cites an excerpt tangentially — e.g. for "suggest a job portal she can
     apply on", retrieval surfaces her résumé (which name-drops "Naukri / LinkedIn
     Recruiter" as tools she *used* as a recruiter), and the grounded answer says "the
     excerpts mention Naukri and LinkedIn… I can't give a definitive suggestion." That
     cites a chunk and scores fine, so it wrongly won the documents tier.
   - A *repurposing* answer — same retrieval, but the model confidently recasts those
     tools-she-used as portals-she-should-apply-on. Also cites a chunk, also scored fine,
     also wrongly won.

   Fix: `evaluateAnswer` now returns an explicit `answered` boolean, and the judge prompt
   defines it strictly — false for declines/hedges, AND false when the question asks for a
   recommendation/suggestion/advice and the answer only works by repurposing an *incidental
   mention* from the excerpts into that recommendation ("the excerpts describing something
   is not the same as the excerpts recommending it"). Documents-tier success now gates on
   `answered`, so both shapes correctly fall through to the general/web fallback. Verified:
   the job-portal query now consistently (3/3 runs) reaches the fallback and returns real
   portal suggestions, while genuine document questions ("what is her current role", "tell
   me about my latest upload") stay in the documents tier.

   **`evaluateAnswer` is now conversation-aware.** A third report: after a general/web
   answer listing job portals, the follow-up "give me the links for those" refused. Root
   cause was a context gap — retrieval and the grounded answerer both get the conversation
   history (and `condenseQuery` resolves "those"), but the *judge* did not, so it graded a
   context-dependent follow-up blind and could accept an irrelevant documents answer (e.g.
   a vague follow-up drifting to an unrelated resource that happens to contain links).
   `evaluateAnswer` now takes `history` too and includes it in the grading prompt, so
   `answered`/`score` are judged against what the user actually meant in context. Verified
   3/3 that the follow-up now correctly falls through to the fallback and returns the job
   portals' links rather than an unrelated document's links.
2. **Fallback tier** (`src/lib/llm/answerFromKnowledge.ts`, new): OpenAI **Responses API**
   with the `web_search` tool on `gpt-4o-mini`. The model answers from general knowledge
   and calls web search itself when the question benefits from live/verifiable info.
   `mode` is `"web"` when a web search actually ran (detected via a
   `response.output_item.added` event whose item is a `web_search_call`, OR any
   `url_citation` annotation) and `"general"` otherwise. Web citations (url + title) are
   collected from `response.output_text.annotation.added` events. Note: some tool
   responses (e.g. the weather widget) return data with **no** `url_citation` annotations
   — the `web_search_call` detection is what still labels those `"web"` (with an empty
   links list) rather than mislabeling them `"general"`.

Streaming — **only the winning answer is ever shown** (revised after a user reported
seeing "one response and suddenly another"). The earlier version streamed the first
document attempt live and, if it lost, swapped in the fallback via an `onReplace` event —
so the user briefly saw the losing doc decline before it was replaced. Now the document
tier is generated and judged **silently** (no `onDelta` during generation); only once an
answer actually wins is it sent to the caller. A winning document answer is replayed in
small word-batches via `replay()` (it was already fully generated for judging, so it
can't stream live — the replay reproduces the typing feel); the fallback still streams
live token-by-token. `onReplace` and the `replace`/`retry` SSE events were removed
entirely — nothing is ever streamed and then replaced. Trade-off: a document answer now
shows the "thinking" shimmer through generation+judging before it starts replaying,
instead of streaming as it generates — accepted in exchange for zero flicker. Verified:
both a documents answer and a fallback answer emit **0** `replace` events; the fallback
case's very first streamed tokens are the real fallback answer, never a doc-tier decline.

Provenance surfaced end-to-end:
- `src/types/chat.ts`: added `WebSource`, `AnswerMode = "documents" | "general" | "web"`;
  `ChatAssistantMessage` gained `mode?` and `webSources?`.
- `src/app/api/chat/route.ts`: the `sources` SSE event now carries `{ mode, sources,
  webSources }`.
- `src/components/chat/ChatPanel.tsx`: stores `mode`/`webSources` on the assistant message
  from that event.
- `src/components/chat/ChatMessageView.tsx`: a `Provenance` sub-component renders the
  three badge variants (lucide `BookOpen`/`Sparkles`/`Globe` icons), including clickable
  web-source links (`target=_blank`, `rel=noopener`), hidden while `isStreaming`.

## Files touched
- `src/lib/llm/answerFromKnowledge.ts` — new; general-knowledge + web-search fallback via
  Responses API, returns `{ answer, mode, webSources }`
- `src/lib/rag/answerWithRetry.ts` — restructured into the documents→fallback tiered flow;
  return type gained `mode` + `webSources`; documents tier generated+judged silently and
  the winner replayed via `replay()`; `onRetry`/`onReplace`/deterministic-decline removed
  (only the winning answer is ever streamed, so nothing is replaced)
- `src/types/chat.ts` — `WebSource`, `AnswerMode`, extended `ChatAssistantMessage`
- `src/app/api/chat/route.ts` — `sources` event carries `mode` + `webSources`
- `src/components/chat/ChatPanel.tsx` — stores provenance from the `sources` event
- `src/components/chat/ChatMessageView.tsx` — `Provenance` badges (documents/general/web)
- `src/lib/llm/judgeAnswer.ts` — `evaluateAnswer` now returns an explicit `answered`
  boolean (declines/hedges/incidental-mention-repurposing → false) that gates the
  documents tier, and now takes conversation `history` so context-dependent follow-ups
  are graded in context; documents-tier grounded answerer (`answerQuestion.ts`) itself
  unchanged and still strict

## Verification
`bunx tsc --noEmit` / `bun run lint` clean. Live-verified against the running
`dev`+`worker`+docker stack:
- Isolated `answerFromKnowledge` test: a "list HR job platforms" question answered from
  general knowledge (`mode: "general"`, no sources); a "latest OpenAI announcements this
  week, include links" question triggered a real web search (`mode: "web"`) and returned
  actual citation URLs+titles (Axios, Tom's Hardware).
- Full pipeline via `POST /api/chat`:
  - The exact repro ("suggest where Preeti can apply, list platforms", with history) now
    returns a helpful platform list labeled `mode: "general"` instead of refusing.
  - "Tell me about latest doc I have uploaded" still returns `mode: "documents"` with the
    correct `resume`/appointment-letter source — documents tier unregressed.
  - "Current weather in Tokyo right now" returns live data labeled `mode: "web"` (the
    `web_search_call` detection correctly labels it web despite no url_citation
    annotations on that tool response).

## Possible follow-ups (not done)
- Let the documents and web tiers *combine* in one answer (e.g. "what does my resume say
  and how does that compare to current market rates") rather than being either/or.
- Persist/honor a user preference to disable the web tier per-conversation if cost/latency
  is a concern.
- The web tool occasionally echoes a Markdown heading (e.g. the weather widget's "##
  Weather for …") despite the no-headings instruction — cosmetic, could be stripped.
