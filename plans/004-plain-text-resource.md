# Add Plain Text as a Resource Type (alongside PDF and URL)

**Status:** done

## Context
`noteboolm` supported PDF upload and web-URL resource types
([[001-pdf-upload-indexing-pipeline]], [[003-web-url-resource]]). This adds a
third type — the user pastes raw text directly (no file, no URL) — through
the same chunk → embed → Qdrant pipeline.

Decisions:
- **Max length: 100,000 characters.** The full text is passed raw through the
  BullMQ job payload into Redis (same no-permanent-storage pattern as PDF
  base64 / URL html), so the cap bounds Redis payload size and worker job
  duration. At 100k chars the shared `chunkText()` (1000/150 defaults,
  [[001-pdf-upload-indexing-pipeline]]) produces ~110 chunks — 1-2
  `embedTexts()` batches (`BATCH_SIZE = 100`). ~40 pages / 15-20k tokens,
  comfortably covering a single article/transcript/note-dump without
  inviting whole-book pastes. Enforced server-side in the API route
  (`MAX_TEXT_LENGTH`), mirroring `MAX_BYTES` in `src/lib/web/fetchHtml.ts`;
  also shown as a live character counter in the modal (client-side UX only).
- **Title**: user-supplied by default (optional input field in the modal).
  If left blank, generated synchronously in `POST /api/resources` via a new
  `generateTitle()` helper (`src/lib/llm/generateTitle.ts`) — a
  `gpt-4o-mini` chat-completion call fed only the first ~2000 characters of
  the pasted text, prompted for a concise 3-8 word title. This mirrors how
  URL resources resolve their title synchronously before the resource is
  persisted (rather than in the worker), because the worker process never
  writes to `data/resources.json` — see CLAUDE.md's process-separation rule.
  If the LLM call throws (bad key, rate limit, etc.), falls back to the
  text's first line truncated to 60 chars, so a flaky call never blocks
  resource creation.

## Architecture / Flow
1. `AddResourceModal` gets a third toggle ("Text") alongside PDF / Web link:
   an optional title `<input>` plus a `<textarea>` with a live char counter
   against the 100k cap.
2. `POST /api/resources` branches on `text` in the submitted `FormData` (new
   `handleTextResource`): reject if over `MAX_TEXT_LENGTH` → resolve title
   (user-provided, else `generateTitle()`, else first-line fallback) →
   enqueue `{ type: "text", resourceId, filename: title, text }` (the pasted
   text passed straight through the job payload, same pattern as PDF
   bytes/URL html) → `addResource({ ..., sourceType: "text" })`.
3. Worker (`src/worker/index.ts`) dispatch converted from a binary ternary to
   a 3-way `dispatchJob()`: `"pdf"` → `processPdfJob` (unchanged), `"url"` →
   `processUrlJob` (unchanged), `"text"` → new `processTextJob` (no
   fetch/extract step needed — text is already plain — just
   `chunkText` → `embedTexts` → `ensureCollection` → upsert with
   `sourceType: "text"` payload, reusing the already-resolved `filename`).
4. Delete, status polling, and the sidebar's shimmer/error states are
   unchanged — already source-type-agnostic.
5. Sidebar icon: `NotepadTextIcon` for `"text"`, alongside existing
   `GlobeIcon` (url) / `FileTextIcon` (pdf).
6. Follow-up: `ResourceListItem`'s truncated filename now carries a native
   `title` HTML attribute (full filename, or the error message when
   `status === "failed"`) so a hover reveals the untruncated name — added
   because LLM-generated and long pasted-text titles are more likely to
   overflow the sidebar width than PDF filenames/URL titles were.
7. Follow-up: realistic per-type icons. `src/lib/resources/sourceTypeMeta.ts`
   (new shared module) maps `sourceType → { icon, colorClass, label }`,
   used by both `ResourceListItem` and `AddResourceModal`'s mode toggle —
   `PdfBadgeIcon` (new: `src/components/icons/PdfBadgeIcon.tsx`, a small
   inline SVG red document-with-folded-corner + "PDF" glyph — no PDF icon
   existed in lucide-react or anywhere in the repo, hand-built rather than
   adding a dependency) for `"pdf"`, `GlobeIcon` (orange/blue/violet
   `--source-pdf`/`--source-url`/`--source-text` CSS tokens, see
   `globals.css`) for `"url"`, `NotepadTextIcon` for `"text"`. `url`
   resources additionally render the real site favicon (see
   [[003-web-url-resource]]'s follow-up) instead of `GlobeIcon` when one was
   extracted, falling back to the colored globe on load failure. Legacy
   resources predating `sourceType` fall back to `SOURCE_TYPE_META.pdf`
   (fixed after a runtime crash — `SOURCE_TYPE_META[undefined]` threw since
   those records have no `sourceType` field at all).

## Files touched
- New: `src/lib/llm/generateTitle.ts`, `src/worker/processTextJob.ts`
- Modified: `src/types/resource.ts` (`ResourceSourceType` gains `"text"`,
  new `IndexTextJobData`, union widened), `src/worker/index.ts` (3-way
  dispatch), `src/app/api/resources/route.ts` (`handleTextResource` +
  `MAX_TEXT_LENGTH`), `src/components/sidebar/AddResourceModal.tsx` (third
  mode: title input + textarea + char counter), `src/components/sidebar/ResourceListItem.tsx`
  (icon for `"text"`)

## Verification (live, against the already-running dev server + worker + docker services)
- Pasted a ~450-char paragraph with no title → `POST /api/resources`
  returned filename `"NotebookLM: Research and Note-Taking Assistant"`
  (LLM-generated via `gpt-4o-mini`), job completed (`chunkCount: 1`,
  `status: "completed"`), confirmed via Qdrant `points/scroll` — payload had
  correct `sourceType: "text"`, `filename`, `resourceId`, `chunkIndex`.
- Submitted with an explicit `title` field → used verbatim, no LLM call.
- Submitted 100,001 characters → `400` with `"Text is too long (max
  100,000 characters)"`, no job created.
- All three test resources deleted afterward (confirmed `200` from
  `DELETE /api/resources/:id`).
- `bunx tsc --noEmit` and `bun run lint` both clean.
