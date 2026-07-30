# YouTube Resource Type + Pinpoint Source Citations + Self-Grading Retry Loop

**Status:** in progress — citations restructuring and the retry/judge loop are done and
live-verified; YouTube ingestion itself is still not started.

## Context
`plans/005` shipped grounded chat answers with page-number citations for PDFs, but
explicitly deferred click-to-preview sources to a later plan. This plan covers three
related extensions the user wants next:

1. **Pinpoint citations** (done) — chat answers should tell the user exactly *where* in
   the source a claim came from: a page number for PDFs (already done pre-existing), a
   timestamp for YouTube videos once that resource type exists, so the UI can eventually
   jump straight to that spot (page/timestamp deep-link is a further UI plan, out of
   scope here — this plan is about capturing and surfacing the location data through
   retrieval and the answer, and about the *sources* shown actually being what the model
   used, not just everything retrieved).
2. **Self-grading retry loop** (done) — instead of one fixed retrieve→answer pass, a
   small model grades the answer's relevance 0-10 against the question and its excerpts;
   below 6, reformulate the search query and retry, up to 3 attempts total, keeping the
   best-scoring attempt if none clears the bar. Discussed alongside `openai-agents-js`
   (see below) but implemented as a plain bounded loop, not a tool-calling agent — there
   was no need for the model itself to decide whether/how to re-query, since the
   retry/scoring policy is fixed and external.
3. A **YouTube resource type** (not started) — customers paste a YouTube URL, we fetch
   the video's transcript, chunk it, and index it like any other resource.

Decisions made with the user up front:
- Official YouTube Data API v3 is **not viable** for this: `captions.download`
  requires OAuth as the video's own channel owner, so it can't fetch transcripts for
  arbitrary third-party public videos, which is the whole point of this feature.
  Decided to fetch the public timed-text caption track directly instead (same approach
  most YouTube-transcript tools use) — no API key, no OAuth, works for any video with
  captions (creator-provided or auto-generated). Documented risk: it's an undocumented
  endpoint that could change without notice.
- Citation pinpointing is being treated as a **data-modeling problem, not an agent
  problem** — the retrieval step already knows which chunk matched (that's how `page`
  works today), so timestamps just ride along the same path. No LLM tool-calling is
  required to "find" the timestamp.
- Agentic tool-calling (`openai-agents-js`, wrapping `retrieveContext()` as a
  `searchDocuments` tool so the model can re-query when the first retrieval is thin) was
  discussed as a **separate, later** enhancement — not needed for pinpoint citations,
  and deliberately out of scope for this plan to avoid bundling two unrelated changes.

## Architecture / Flow

### Pinpoint citations + retry loop (implemented)
- **`src/lib/llm/answerQuestion.ts`**: switched from free-text completion to a
  structured-output JSON schema response (`RESPONSE_SCHEMA`, `strict: true`):
  `{ answer: string, usedExcerpts: number[] }`, where `usedExcerpts` are the `[N]`
  excerpt markers the model actually relied on. `answerQuestion()` now returns
  `{ answer, citedChunks }` — `citedChunks` is `usedExcerpts` mapped back to the actual
  `RetrievedChunk` objects passed in, so the caller's "Sources" list reflects only what
  the model drew on, not every chunk retrieval happened to return. Few-shot examples
  updated to demonstrate the JSON shape (including `usedExcerpts: []` for the
  correctly-declined case) so the model doesn't drift back to prose under the schema
  constraint.
- **`src/lib/llm/judgeAnswer.ts`** (new): a `gpt-4o-mini` call, structured-output
  schema `{ score: integer 0-10 }`, grading the answer against the question and its
  cited excerpts. Explicitly instructed that a confident, correct "the documents don't
  cover this" is a *good* answer (score high) when the excerpts genuinely don't address
  the question — otherwise the retry loop would waste attempts trying to force a match
  for legitimately out-of-scope questions. On any API/parse failure, returns 10 (treats
  a judge failure as a pass, so an unrelated hiccup can't block the user's answer).
- **`src/lib/rag/queryTransform.ts`**: added `refineQuery(query, weakAnswer)` — a second
  `gpt-4o-mini` JSON-mode call that proposes an alternate phrasing of the search query
  (different wording/angle, same underlying question) given the original query and the
  weak answer it produced. Falls back to the original query on any failure.
- **`src/lib/rag/answerWithRetry.ts`** (new): the orchestrator — loops
  analyzeQuery → retrieveContext → answerQuestion → judgeAnswer up to `MAX_ATTEMPTS = 3`
  times, reformulating the search query via `refineQuery()` between attempts, accepting
  the first attempt scoring `>= MIN_ACCEPTABLE_SCORE = 6`, otherwise returning the
  best-scoring attempt seen once attempts are exhausted (never fails outright — always
  returns *an* answer).
- **`src/app/api/chat/route.ts`**: now calls `answerWithRetry(query)` directly instead of
  inlining `analyzeQuery`/`retrieveContext`/`answerQuestion`; builds `sources` from
  `citedChunks` instead of all retrieved chunks.
- Deliberately **not** built on `openai-agents-js` — this is a fixed external
  retry/scoring policy, not the model deciding whether/how to re-query, so a plain bounded
  loop was simpler and sufficient. The earlier discussion's actual `openai-agents-js`
  use case (the model itself choosing to call a `searchDocuments` tool mid-reasoning)
  remains a distinct, not-yet-built idea if a future need calls for genuine multi-step
  agentic tool use rather than a fixed retry policy.

### YouTube resource type (not started — proposed design below)

1. **Resource type** (`src/types/resource.ts`): add `"youtube"` to
   `ResourceSourceType` and a new `IndexYoutubeJobData { type: "youtube"; resourceId;
   url; videoId }` to the `IndexResourceJobData` union, mirroring `IndexUrlJobData`.
2. **Transcript fetch** (`src/lib/youtube/fetchTranscript.ts`, new): given a video ID,
   fetch the public timed-text track (the same one the YouTube player loads) —
   no arbitrary user-supplied URL is fetched server-side here (only YouTube's own
   endpoints, parameterized by video ID), so this sits outside the SSRF-guarded
   `fetchHtml` path by design, not as an oversight. Returns an ordered list of
   `{ text, start, duration }` segments.
3. **Timestamp-aware chunking** (`src/worker/processYoutubeJob.ts`, new, mirroring
   `processPdfJob.ts`'s per-page chunking): group consecutive transcript segments into
   windows via the existing `chunkText()` and, for each resulting chunk, record the
   `startTime` of its first segment and `endTime` of its last (seconds) — same pattern
   as `page` today, just a different unit. Upsert to Qdrant with `sourceType:
   "youtube"` and `startTime`/`endTime` payload fields.
4. **Retrieval** (`src/lib/rag/retrieve.ts`): `RetrievedChunk` gains optional
   `startTime`/`endTime` fields alongside the existing optional `page`, populated from
   the Qdrant payload when `sourceType === "youtube"`.
5. **Answer generation** (`src/lib/llm/answerQuestion.ts`, already structured-output as
   of the citations work above): once `RetrievedChunk` carries `startTime`/`endTime`,
   no further change needed here — `citedChunks` already carries whatever location
   fields the chunk has; the API route/UI just need to format timestamp vs. page.
6. **UI**: `ChatMessageView.tsx`'s existing `Sources: file.pdf (page 4)` line extends to
   `video-title (04:32)` for YouTube sources. Click-to-seek/scroll deep-linking remains
   deferred to a future plan, as in `plans/005`.

## Open questions to resolve before implementation
- Transcript-fetch approach: **decided** — hand-rolled fetch against YouTube's
  `timedtext` endpoint directly (no new dependency), accepting the risk that it's an
  undocumented endpoint that could change without notice.
- Video ID extraction/validation from arbitrary pasted URLs (youtu.be, `?v=`, embed
  URLs, playlist-qualified URLs) needs its own small parser + validation, similar in
  spirit to `ipGuard.ts` for URLs.
- Whether resources without any captions available (many videos have none) should fail
  the job outright or fail gracefully with a clear "no captions available" resource
  error status.

## Architecture / Flow — addendum: streaming + Markdown rendering

Requested after the citations/retry work above: chat answers were appearing all at once
instead of streaming, and rendered as plain `<p>` text with no list/table/heading support.

- **`src/lib/llm/answerQuestion.ts`**: switched from a single non-streaming call to
  `stream: true`, invoking an `onDelta(text)` callback per token chunk as it arrives.
  Dropped inline `[N]` citation-marker instructions from the prompt — **found via live
  testing that gpt-4o-mini reliably omits them** for confident, single-source answers
  (verified: asking about `resume.pdf` produced a fully-grounded multi-bullet answer with
  zero `[N]` markers despite an explicit mandatory-citation instruction + a matching
  few-shot example), which silently produced an empty Sources list. Reverted to plain,
  citation-marker-free Markdown prose instead of continuing to fight the model into a
  streaming-incompatible JSON-schema response.
- **`src/lib/llm/judgeAnswer.ts`** (renamed export: `judgeAnswer` → `evaluateAnswer`):
  the relevance-scoring call now *also* returns `citedChunks` in the same structured-output
  JSON schema call (`{ score, usedExcerpts }`), since that's a small, deterministic,
  non-streamed call anyway — reliable citation identification without needing the
  streamed prose to carry any citation markup at all. This replaces the old approach of
  extracting citations from the streamed text itself.
- **`src/lib/rag/answerWithRetry.ts`**: threads through `AnswerWithRetryCallbacks`
  (`onDelta`, `onRetry`, `onReplace`) so a caller can render the currently-streaming
  attempt live. `onRetry` fires when an attempt is judged too low and about to be
  discarded (caller clears the display before the next attempt streams in); `onReplace`
  is the rare final-correction path — if attempts are exhausted and the best-scoring
  attempt wasn't the last one displayed, it delivers that attempt's full text in one shot
  rather than re-streaming it token-by-token.
- **`src/app/api/chat/route.ts`**: rewritten as a Server-Sent-Events endpoint
  (`ReadableStream` response, `text/event-stream`) emitting `delta` / `retry` / `replace` /
  `sources` / `done` / `error` events, replacing the old single JSON-blob response.
- **`src/types/chat.ts`**: `ChatAssistantMessage.paragraphs: ChatAssistantParagraph[]`
  replaced with a single `text: string` (Markdown, appended to incrementally) +
  `isStreaming?: boolean`.
- **`src/components/chat/ChatPanel.tsx`**: `handleSend` now manually parses the SSE
  stream over `fetch()`'s `ReadableStream` (no `EventSource`, since that doesn't support
  POST bodies), appending `delta` text to the in-progress assistant message, clearing it
  on `retry`, and swapping in the full text on `replace`.
- **`src/components/chat/ChatMessageView.tsx`**: assistant messages now render via
  `react-markdown` + `remark-gfm` (new deps) inside a `.markdown-answer.prose` wrapper, so
  bullets/numbered lists/tables/headings render properly; a small pulsing block cursor
  renders while `isStreaming` is true.
- **`src/app/globals.css`**: added `@tailwindcss/typography` (new dep) via
  `@plugin "@tailwindcss/typography"`, plus a `.markdown-answer` block overriding the
  plugin's `--tw-prose-*` variables to route through this repo's existing color tokens
  (`--foreground`, `--primary`, `--border`, etc.) instead of the plugin's default gray
  scale, so it stays theme-correct in both light and dark automatically.

## Architecture / Flow — addendum: natural prose, not bullets-by-default

Follow-up after the streaming/Markdown work: the model was defaulting to headings +
bullet lists for almost every answer, including plain narrative questions ("tell me
about X's work experience"), apparently because the retrieved excerpts themselves were
often bulleted (e.g. a resume) and it was echoing that structure back regardless of
what the question actually called for.

- **`src/lib/llm/answerQuestion.ts`**: rewrote the formatting rule to default to
  natural, flowing prose and only reach for a list/table when it genuinely earns its
  keep (question explicitly asks for steps/a list; several genuinely parallel items that
  are hard to read as a sentence; a real multi-attribute comparison for tables) —
  explicitly calling out that the excerpts being bulleted doesn't mean the answer should
  be. Banned Markdown headings entirely for chat answers. Added two more few-shot pairs:
  a narrative "tell me about my last role" question answered in pure prose, and a
  genuinely enumerable "what steps do I need to..." question answered with a numbered
  list — so both patterns are modeled explicitly, not just structured ones.
- Live-verified: the exact repro question ("tell me about Mukesh Mohanty's work
  experience", two roles) now answers with light bullets and no headings (reasonable —
  two parallel roles); a narrower single-role question ("what did mukesh do at
  mitsogo") now answers in pure prose with zero list markup, confirming formatting now
  follows the query instead of defaulting to structure everywhere.

## Task checklist

### Citations + retry loop
- [x] `answerQuestion()` switched to structured output (`{ answer, usedExcerpts }`) and
      returns `{ answer, citedChunks }`
- [x] `judgeAnswer()` — 0-10 relevance grading via `gpt-4o-mini`, with correct declines
      scored high
- [x] `refineQuery()` — reformulates the search query between retry attempts
- [x] `answerWithRetry()` — orchestrates up to 3 attempts, keeps best-scoring result
- [x] `POST /api/chat` wired to `answerWithRetry`; sources built from `citedChunks` only
- [x] `bunx tsc --noEmit` / `bun run lint` clean
- [x] Live-verified against the running stack: resume.pdf question returns a single
      accurate `citedChunks` source (not all 5 retrieved resources); an out-of-scope
      question (liquid helium/MRI) correctly declines with zero sources in one attempt
      (confirming the judge doesn't force pointless retries on honest declines); forced
      a full 3-attempt exhaustion by temporarily setting `MIN_ACCEPTABLE_SCORE = 11`
      (unreachable) — response time roughly doubled and it still returned a coherent
      best-of-attempts answer instead of failing; reverted after confirming.

### Streaming + Markdown rendering
- [x] `answerQuestion()` streams via `onDelta`, dropped inline citation markers from the
      prompt after finding they were unreliable
- [x] `evaluateAnswer()` (renamed from `judgeAnswer()`) returns `{ score, citedChunks }`
      in one structured-output call
- [x] `answerWithRetry()` threads `onDelta`/`onRetry`/`onReplace` callbacks
- [x] `POST /api/chat` rewritten as an SSE endpoint
- [x] `ChatPanel.tsx` consumes the SSE stream and updates message state incrementally
- [x] `ChatMessageView.tsx` renders Markdown via `react-markdown` + `remark-gfm`
- [x] `@tailwindcss/typography` added and themed via `.markdown-answer` prose-variable
      overrides in `globals.css`
- [x] `bunx tsc --noEmit` / `bun run lint` clean
- [x] Live-verified via raw `curl -N` against the SSE endpoint: confirmed real
      token-by-token `delta` events (not one final blob), confirmed `sources`/`done`
      terminate the stream correctly, confirmed the out-of-scope decline case still
      returns zero sources; found and fixed a real bug where the model omitted `[N]`
      citation markers entirely for confident single-source answers (empty Sources list)
      — fixed by moving citation identification into `evaluateAnswer`'s structured output
      instead of relying on markers in the streamed prose; re-verified the exact repro
      query now returns the correct `resume.pdf` source
- [x] Markdown rendering sanity-checked via `renderToStaticMarkup` outside the browser
      (headings/nested lists/GFM tables all produced correct HTML) — **not yet visually
      checked in an actual browser**; no browser-automation tool was available in this
      session to do so

### YouTube resource type
- [ ] `src/types/resource.ts` — add `youtube` resource type + job data shape
- [ ] `src/lib/youtube/fetchTranscript.ts` — transcript fetch + video ID parsing
- [ ] `src/worker/processYoutubeJob.ts` — timestamp-aware chunking + Qdrant upsert
- [ ] Dispatcher branch in `src/worker/index.ts`
- [ ] Resource creation API path (mirror `src/app/api/resources` URL flow) + icon in
      `ResourceListItem`
- [ ] `RetrievedChunk` gains `startTime`/`endTime`
- [ ] `ChatMessageView.tsx` renders timestamp-formatted sources for YouTube
- [ ] `bunx tsc --noEmit` / `bun run lint` clean
- [ ] Live verification: index a real YouTube video, ask a question answerable from a
      specific point in it, confirm the returned citation's timestamp is accurate

## Files touched
- `src/lib/llm/answerQuestion.ts` — streams the answer via `onDelta`; no citation markers
  in the prompt (found unreliable)
- `src/lib/llm/judgeAnswer.ts` — new; `evaluateAnswer()` returns `{ score, citedChunks }`
  in one structured-output call (0-10 relevance grading + citation identification)
- `src/lib/rag/queryTransform.ts` — added `refineQuery()`
- `src/lib/rag/answerWithRetry.ts` — new; retrieve→stream-answer→evaluate retry
  orchestrator with `onDelta`/`onRetry`/`onReplace` callbacks
- `src/app/api/chat/route.ts` — rewritten as an SSE endpoint over `answerWithRetry`
- `src/types/chat.ts` — `ChatAssistantMessage` now has `text: string` + `isStreaming?`
  instead of `paragraphs: ChatAssistantParagraph[]`
- `src/components/chat/ChatPanel.tsx` — manual SSE parsing over `fetch()`'s stream,
  incremental message state updates
- `src/components/chat/ChatMessageView.tsx` — renders Markdown via `react-markdown` +
  `remark-gfm`, streaming cursor indicator
- `src/app/globals.css` — `@tailwindcss/typography` plugin + `.markdown-answer`
  prose-variable theming
- `package.json` — added `react-markdown`, `remark-gfm`, `@tailwindcss/typography`
- YouTube ingestion files: none yet
