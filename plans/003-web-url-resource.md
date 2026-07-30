# Add Web URL as a Resource Type (alongside PDF)

**Status:** done

## Context
`noteboolm` only supported PDF uploads. This adds a second resource type — a plain
`https://` web link — indexed through the same chunk → embed → Qdrant pipeline as
[[001-pdf-upload-indexing-pipeline]], so a user can mix PDFs and web pages in one
knowledge base.

Decisions:
- **Title**: fetched synchronously in `POST /api/resources` (the request itself
  fetches the page once to pull `<title>`), so the sidebar shows the real page
  title immediately rather than the raw URL.
- **Safety (SSRF guard)**: `src/lib/web/ipGuard.ts` resolves the hostname via DNS
  and rejects loopback/private/link-local/unique-local ranges (IPv4 + IPv6),
  `src/lib/web/fetchHtml.ts` layers on a 15s timeout, ~5MB size cap, manual
  redirect handling (re-checked through the same guard per hop, max 5 hops), and
  a content-type check (must look like HTML).

## Architecture / Flow
1. `AddResourceModal` has a PDF / Web-link segmented toggle; web-link mode shows a
   single URL input instead of the file picker.
2. `POST /api/resources` branches on `file` vs `url` in the submitted `FormData`.
   For `url`: validate protocol → `fetchHtml(url)` once → extract `<title>` via
   `cheerio` → enqueue `{ type: "url", resourceId, url, html }` (the fetched HTML
   is passed straight through the job payload — same no-permanent-storage pattern
   already used for PDF bytes, so the worker never re-fetches the page).
3. Worker (`src/worker/index.ts`) dispatches on `job.data.type`: `"pdf"` →
   `processPdfJob` (unchanged), `"url"` → new `processUrlJob` (parses the
   passed-through `html` with `extractReadableText`, then the same
   chunk/embed/upsert steps as the PDF path).
4. Delete, status polling, and the sidebar's shimmer/error states are unchanged —
   they were already source-type-agnostic.
5. Sidebar icon switches on `Resource.sourceType`: `GlobeIcon` for `"url"`,
   `FileTextIcon` for `"pdf"`.

**Follow-up (favicons):** `extractReadableText` now also resolves the page's
favicon — checks `<link rel="icon">` / `"shortcut icon"` / `"apple-touch-icon"`
(first match wins), resolved to an absolute URL against the page URL via the
`URL` constructor, falling back to `${origin}/favicon.ico` if no `<link>` tag
exists. The function signature gained a required second `pageUrl` param.
Stored as `Resource.faviconUrl`, persisted the same way as `sourceUrl`, and
rendered client-side as an `<img>` directly against that URL (not proxied
through the server — purely cosmetic, no SSRF-guard needed) with `onError`
falling back to the colored `GlobeIcon`. See
[[004-plain-text-resource]]'s follow-up note for the rest of the per-type
icon system (`SOURCE_TYPE_META`, the PDF badge icon).

## Files touched
- New: `src/lib/web/ipGuard.ts`, `src/lib/web/fetchHtml.ts`,
  `src/lib/web/extractReadableText.ts`, `src/worker/processUrlJob.ts`
- Modified: `src/types/resource.ts` (discriminated union `IndexResourceJobData`,
  `Resource.sourceType`/`sourceUrl`), `src/lib/queue/indexQueue.ts` (generic types
  broadened, queue name unchanged), `src/worker/index.ts` (dispatch by
  `job.data.type`), `src/worker/processPdfJob.ts` (payload gains `sourceType:
  "pdf"`), `src/app/api/resources/route.ts` (branches `file`/`url`),
  `src/components/sidebar/AddResourceModal.tsx` (mode toggle + URL input),
  `src/components/sidebar/Sidebar.tsx`, `src/components/sidebar/ResourceListItem.tsx`
  (icon by `sourceType`)
- New dependency: `cheerio`

## Verification (all done live against the running dev server + worker)
- Added `https://en.wikipedia.org/wiki/Retrieval-augmented_generation` — title
  fetched synchronously ("Retrieval-augmented generation - Wikipedia"), job
  completed with 31 chunks, points confirmed in Qdrant via `points/scroll` with
  correct `sourceType`/`sourceUrl`/`filename` payload.
- SSRF guard: `http://localhost:3000` and `http://127.0.0.1:6333` both rejected
  synchronously at submit time with a clear error, no job created.
- Non-HTML URL (a direct `.pdf` link) rejected cleanly via the content-type check.
- Delete confirmed working for a URL resource (removed from sidebar + Qdrant
  point count dropped).
