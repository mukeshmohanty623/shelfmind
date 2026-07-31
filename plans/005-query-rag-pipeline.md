# Query-side RAG Pipeline for Chat

**Status:** done — implemented and verified end-to-end against the live stack.

## Context
The chat UI (`ChatPanel.tsx`, `ChatInput.tsx`, `ChatMessageView.tsx`) has existed since
early on but was never wired up — `handleSend` was a `setTimeout` stub that always
replied "Chat isn't wired up to your resources yet." This plan implements the real
query-side RAG pipeline against the Qdrant index built by `plans/001`, `003`, `004`:
multi-query retrieval (HyDE + step-back + sub-questions), top-5-distinct-resource
context selection, and a grounded LLM answer with a plain-text source list (page
numbers included). Click-to-preview UI for sources is explicitly deferred to a later
plan.

Decisions made with the user up front:
- Citations need **real page numbers**, not just chunk index — required making PDF
  extraction page-aware (it previously flattened to one string with no page
  boundaries).
- "Top 5" context means **top 5 distinct resources** (best-scoring chunk per resource,
  across up to 5 different documents), not top 5 chunks that could all be from one
  document.

## Architecture / Flow
1. **Page-aware PDF extraction** (`src/lib/pdf/extractText.ts`): now returns
   `{ text, pages: { num, text }[] }` using `pdf-parse`'s existing per-page output
   (no new dependency). `src/worker/processPdfJob.ts` chunks each page separately via
   the existing `chunkText()`, tagging every chunk with its source `page` number.
   Chunks no longer span page boundaries — an accepted simplification. URL/text
   resources have no page concept and omit the field.
2. **Query transformation** (`src/lib/rag/queryTransform.ts`): `analyzeQuery(query)`
   makes one `gpt-4o-mini` call (JSON mode) that returns a HyDE hypothetical-answer
   passage, a step-back (broader) question, and 2-3 sub-questions. Falls back to
   `{ hyde: query, stepBack: query, subQuestions: [] }` on any parse/API failure so
   retrieval always has at least the raw query.
3. **Multi-query retrieval** (`src/lib/rag/retrieve.ts`): embeds all query variants in
   one batched `embedTexts()` call, searches Qdrant with `client.searchBatch()` (one
   request, one search per variant, limit 8 each), then reduces to the single
   best-scoring chunk per `resourceId` and takes the top 5 resources by that score.
   Resolves each winner's canonical `filename`/`sourceType`/`sourceUrl` via
   `getResource()`. Applies `score_threshold: 0.35` on the Qdrant search — found during
   verification that unrelated queries still returned nearest-neighbor "matches" from
   the corpus (Qdrant always returns *something*), which the answer model correctly
   ignored but which still showed up as misleading "Sources:" in the UI. The threshold
   is a heuristic for `text-embedding-3-small` cosine similarity (unrelated text scores
   ~0.2-0.3 against most corpora, genuinely relevant matches ~0.4+) — not perfect, may
   need tuning per corpus.

   **Bug found and fixed post-launch**: asking "tell me about Mukesh Mohanty"
   (answerable only from `resume.pdf`) also cited an unrelated academic paper
   (`take-step-back.pdf`). Root-caused by directly re-running the exact
   `analyzeQuery()` prompt: `gpt-4o-mini` doesn't know who the named person is, so
   its HyDE passage **hallucinates** a generic "AI/ML industry expert" bio, and that
   fabricated-but-fluent text embeds close to real AI/ML papers in the corpus —
   measured at 0.40 similarity, comfortably clearing `SCORE_THRESHOLD = 0.35`, while
   the raw query itself only scored 0.29 against that same paper (i.e. the raw
   question never would have retrieved it — the hallucinated variant did). A flat
   threshold can't fix this: the correct match (`resume.pdf`) scored 0.64, so no
   single absolute cutoff separates "real answer" from "hallucination-adjacent noise"
   across different queries. Fixed by adding `MAX_SCORE_MARGIN = 0.15`: after
   reducing to best-score-per-resource, drop any resource scoring more than that
   margin below the single highest-scoring resource, before slicing to top 5. Verified
   the fix resolves the repro and doesn't regress the two previously-verified cases
   (see checklist).

   **Second bug found and fixed**: "do you have my resource having ACK106099170300526
   as a title, if yes can you tell me brief about it?" flakily failed (~2/5 repeated
   identical calls). Root cause: this resource's content (an Indian income tax
   acknowledgement) only weakly matches an ID-lookup-style query semantically — its
   best score sits at ~0.35-0.39, right on top of `SCORE_THRESHOLD`, and
   `analyzeQuery`'s temperature-driven phrasing variance was enough to flip it above
   or below the cutoff between calls. Exact IDs/codes are a known weak point for dense
   embeddings generally. Fixed two ways: (a) `analyzeQuery` now runs at
   `temperature: 0` + a fixed `seed: 42` for more reproducible query variants
   (verified this alone wasn't sufficient — OpenAI doesn't guarantee full
   determinism even with these settings, ~2/5 runs still missed it); (b)
   `retrieveContext()` (`src/lib/rag/retrieve.ts`) now also checks the raw query
   against every resource's filename (normalized, extension stripped, min 4 chars)
   via `findFilenameMatches()`, and for any match not already surfaced by semantic
   search, force-includes that resource's most relevant chunk (scoped Qdrant search
   filtered by `resourceId`) ahead of the semantic results, bypassing
   `SCORE_THRESHOLD`/`MAX_SCORE_MARGIN` entirely since a literal filename match is a
   confirmed relevant resource. `retrieveContext()` now takes the raw query as a
   second argument for this purpose. Re-verified 5/5 successful runs on the repro
   query with no regression on the two previously-fixed cases.

   **Third bug found and fixed**: "Hi, tell me about the PDF I just uploaded?" returned
   content from an unrelated resource. Root cause: this phrasing names no specific
   document — it only references *recency* — so `findFilenameMatches()` never fires
   (no filename substring present), and retrieval falls through to pure semantic
   ranking with zero recency signal anywhere in it; worse, HyDE generation
   (`queryTransform.ts`) hallucinates a generic passage for this topic-less phrasing,
   which can out-score the real target document in embedding space (same failure class
   as the first bug above, different trigger). Fixed by adding `findRecencyMatch()`
   (`retrieve.ts`) — a regex-based, non-LLM detector for recency-referencing phrases
   ("just uploaded", "recently added", "latest upload", etc.), optionally scoped by a
   resource-type keyword in the query (pdf/link-url/note-text), resolved directly from
   `listResources()`'s existing recency ordering (`src/lib/resources/store.ts` already
   sorts descending by `createdAt` — this was previously unused for retrieval).
   Merged into the same forced-match path as `findFilenameMatches()`, deduplicated by
   resource id. Verified live: the repro query now correctly cites the actual
   most-recently-uploaded PDF (cross-checked against `GET /api/resources` sorted by
   `createdAt`); a type-scoped query with no matching resources yet ("the video I just
   uploaded", no video resource type exists) degrades to an honest decline with no
   sources rather than fabricating an answer; no regression on the filename-lookup or
   out-of-scope-decline cases re-verified above.

   **Follow-up fix to the recency detector**: the first `findRecencyMatch()` regex
   required the recency word to sit *immediately* before the upload verb
   (`latest uploaded`, `last upload`), so a natural phrasing like "tell me about the
   latest doc I have uploaded" — with the resource noun between "latest" and "uploaded"
   — didn't match, fell through to pure semantic search, and HyDE hallucination returned
   the *oldest* resource instead of the newest. Rewrote `RECENCY_PHRASE` as four
   alternated patterns tolerant of a short gap between the recency word and the
   verb/noun ("latest \<noun\>", "\<recency\> ... I (just/recently/have) uploaded",
   "just/recently uploaded", "uploaded ... recently/most recently"). Unit-tested against
   10 should-match phrasings and 6 should-NOT-match content queries (e.g. "the latest
   best practices in the document", "the latest version of the API") — no false
   positives on content queries that merely contain "latest"/"recent". Live-verified
   "tell me about latest doc I have uploaded" now correctly returns the actual
   most-recent upload.
4. **Grounded answer generation** (`src/lib/llm/answerQuestion.ts`): `gpt-4o-mini`
   with a system prompt instructing it to silently analyze the numbered context
   excerpts before answering, answer only from context, and admit when the context
   doesn't cover the question — reinforced with two few-shot examples (one answerable,
   one correctly declined). No chain-of-thought is exposed in the output.
5. **API route** (`src/app/api/chat/route.ts`, `POST`): `{ query }` →
   `analyzeQuery` → `retrieveContext` → `answerQuestion` → `{ answer, sources }`.
   Sources are the deterministic retrieval results, not LLM-generated text — the
   model never has to get citation formatting right.
6. **UI wiring**: `ChatPanel.tsx` now `fetch`es `/api/chat` instead of the old
   `setTimeout` stub (with an in-chat error message on failure); `ChatMessageView.tsx`
   renders a `Sources: file.pdf (page 4) · other.pdf (page 12)` line under assistant
   answers when present. `src/types/chat.ts` gained `ChatSource` and
   `ChatAssistantMessage.sources?`.

## Follow-up: conversation history (multi-turn)
Every query was originally handled in total isolation — `ChatPanel` kept the full
transcript in React state for *display* only; nothing was ever sent to the server
beyond the current message, so a follow-up like "what did they do there, before that
role?" had no prior turn to resolve "there"/"that role" against.

Added:
- `src/types/chat.ts`: `ChatTurn { role: "user" | "assistant"; text: string }` — the
  wire format for prior turns.
- `ChatPanel.tsx`: `buildHistory()` takes the current `messages` state, drops seed
  messages (`id.startsWith("seed-")` — cosmetic demo content, not real conversation),
  caps to the last `MAX_HISTORY_MESSAGES = 6`, sends as `{ query, history }`.
- `POST /api/chat`: `parseHistory()` re-validates and re-caps server-side (role
  restricted to user/assistant, text coerced+trimmed, capped to 6) — doesn't trust the
  client's cap alone.
- `src/lib/rag/queryTransform.ts`: new `condenseQuery(query, history)` — a
  `gpt-4o-mini` call (same fail-open try/catch pattern as `analyzeQuery`/`refineQuery`)
  that rewrites the current message into a standalone, reference-resolved question.
  Only invoked when `history.length > 0` (skipped entirely on a conversation's first
  message — no added latency for the common case).
- `answerWithRetry.ts`: `standaloneQuery = condenseQuery(...)` feeds `analyzeQuery`,
  `retrieveContext`'s `rawQuery` param (filename matching), and `refineQuery` on
  retries — i.e. the whole *search* side uses the reference-resolved version. The
  *original* `query` (exactly what the user typed) still goes to `answerQuestion` and
  `evaluateAnswer`, so the assistant's phrasing matches what was actually asked.
- `answerQuestion.ts`: `history` turns inserted into the chat `messages` array after
  the few-shot examples, before the current `Question: ...` user message — plain
  `{role, content: text}` pairs, giving the model real conversational continuity
  alongside the grounding rules already in `SYSTEM_PROMPT`.
- `evaluateAnswer` (judge) intentionally unchanged — grading doesn't need history.

## Files touched
- `src/lib/pdf/extractText.ts` — page-aware return type
- `src/worker/processPdfJob.ts` — per-page chunking, `page` payload field
- `src/lib/rag/queryTransform.ts` — new (HyDE/step-back/sub-questions);
  `temperature: 0` + `seed: 42` added post-launch for reproducibility
- `src/lib/rag/retrieve.ts` — new (multi-query embed + Qdrant `searchBatch` + merge);
  `MAX_SCORE_MARGIN` relative filter and `findFilenameMatches()` fallback added
  post-launch; now takes the raw query as a second argument; `findRecencyMatch()` added
  post-launch (regex-based recency-phrase detection resolved via `listResources()`'s
  existing `createdAt` ordering)
- `src/lib/llm/answerQuestion.ts` — new (grounded answer w/ few-shot)
- `src/app/api/chat/route.ts` — new; passes the raw query through to `retrieveContext`
- `src/types/chat.ts` — added `ChatSource`, extended `ChatAssistantMessage`
- `src/components/chat/ChatPanel.tsx` — real fetch instead of stub
- `src/components/chat/ChatInput.tsx` — `onSend` typed to allow async
- `src/components/chat/ChatMessageView.tsx` — renders sources line
- Follow-up (conversation history): `src/types/chat.ts` (`ChatTurn`),
  `ChatPanel.tsx` (`buildHistory`), `src/app/api/chat/route.ts` (`parseHistory`),
  `src/lib/rag/queryTransform.ts` (`condenseQuery`), `src/lib/rag/answerWithRetry.ts`
  (`history` param + standalone-query wiring), `src/lib/llm/answerQuestion.ts`
  (`history` param)

## Task checklist
- [x] Page-aware PDF extraction + per-page chunking with `page` payload field
- [x] `analyzeQuery()` — HyDE + step-back + sub-questions via `gpt-4o-mini`
- [x] `retrieveContext()` — multi-query embed, Qdrant `searchBatch`, top-5-distinct-resource merge
- [x] `answerQuestion()` — grounded answer with few-shot prompting
- [x] `POST /api/chat` route
- [x] Wire `ChatPanel`/`ChatMessageView` to the real endpoint
- [x] `bunx tsc --noEmit` / `bun run lint` clean (`bun` lives at `~/.bun/bin`, not on
      PATH by default in this shell — prefix commands with
      `export PATH="$HOME/.bun/bin:$PATH"` if `bun`/`bunx` aren't found)
- [x] Live end-to-end verification against the already-running `dev`+`worker`+docker
      stack: uploaded `resume.pdf` via `POST /api/resources`, confirmed a Qdrant point
      has `"page": 1` in its payload via `points/scroll`; asked a question answerable
      from it via `POST /api/chat` and got a grounded answer with
      `"sources":[{"filename":"resume.pdf","page":1,...}]`; asked a question answerable
      only from the pre-existing (pre-page-aware) `take-step-back.pdf`/
      `theoretica;-limitation-rag.pdf` corpus and got a correct, on-topic grounded
      answer citing both; asked an out-of-scope question (liquid helium/MRI) and the
      model correctly declined instead of hallucinating.
- [x] Fixed HyDE-hallucination-drift bug (irrelevant source cited for an entity
      question) by adding `MAX_SCORE_MARGIN` relative filtering in `retrieve.ts`;
      re-verified the repro case plus both prior test cases with no regression.
- [x] Fixed flaky ID/title-lookup retrieval (`analyzeQuery` temperature=0 + seed=42,
      plus filename-matching fallback in `retrieveContext()`); 5/5 repeated runs
      succeeded post-fix, no regression on prior cases.
- [x] Fixed "tell me about the PDF I just uploaded" retrieving an unrelated resource by
      adding `findRecencyMatch()` in `retrieve.ts` (regex-based recency-phrase
      detection, resolved via `listResources()`'s existing `createdAt` ordering, merged
      into the same forced-match path as `findFilenameMatches()`); live-verified the
      repro now cites the actual most-recent PDF, a type-scoped query with zero
      matching resources degrades to an honest decline, and no regression on the
      filename-lookup/out-of-scope-decline cases above.
- [ ] Click-to-preview source icon in a right sidebar — **deferred to a future plan**,
      out of scope here per explicit user instruction
- [ ] Not yet checked visually in the browser (`ChatPanel`/`ChatMessageView` UI) — API
      responses were verified directly via `curl` against the exact `{answer, sources}`
      shape the UI consumes; a manual click-through in the browser is still worth doing
      before calling this fully done from a UX standpoint.

## Verification
`bunx tsc --noEmit` / `bun run lint` clean. Live-verified via `curl` against the
running `bun run dev` + `bun run worker` + `bun run docker:up` stack (see checklist
above for the exact scenarios exercised).
