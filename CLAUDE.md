# noteboolm

A NotebookLM-style app: upload PDFs or web links, index them (chunk → embed →
Qdrant) via a background queue, and (eventually) chat over them.

## The one rule that matters most: log every change in `plans/`

**Whenever you make a change or implement a feature, write or update a file in
`plans/`** (see `plans/README.md` for the exact convention: `NNN-short-title.md`,
Status/Context/Architecture/Files-touched/Verification). This is not optional
documentation — it's how this repo stays rebuildable from scratch on any machine
and how a future session (yours or a fresh one) picks up context instantly
instead of re-deriving it by reading diffs.

- Small tweaks to something already covered by an existing plan file → update
  that file (its task checklist, its "Files touched" list) rather than creating
  a new one.
- A new feature or a materially different piece of work → new
  `plans/NNN-short-title.md`, next number in sequence.
- Before starting non-trivial work, skim the existing `plans/*.md` files first —
  they're the fastest way to understand why the code looks the way it does.

## Stack & conventions

- **Package manager: bun, always.** `bun install`, `bun add <pkg>`, `bun run
  <script>`. Never `npm`/`yarn`/`pnpm`. The worker is run directly with bun
  (`bun --watch src/worker/index.ts`) since Bun executes TypeScript natively —
  no `tsx`/`ts-node`.
- **Next.js 16, App Router, TypeScript, Tailwind v4.** Path alias `@/*` → `src/*`.
- **UI: shadcn/ui** (`src/components/ui/*`, built on `@base-ui/react`). Add new
  primitives with `bunx shadcn@latest add <component>` rather than hand-rolling
  — decline any prompt to overwrite an already-customized file (e.g.
  `button.tsx` has had its size scale bumped for touch targets; don't let the
  CLI silently revert that).
- **Fonts**: Fraunces (`--font-fraunces`, `font-heading` utility) for headings/
  titles, Public Sans (`--font-public-sans`, default `font-sans`) for
  everything else — wired in `src/app/layout.tsx` + `src/app/globals.css`. If a
  new heading-level element needs the serif, add `font-heading` explicitly.
- **Type scale** (Material-inspired, applied deliberately, not by shadcn
  defaults): Title Large = `text-xl font-semibold` (dialog/section titles),
  Title Medium = `text-base font-medium` (list item primary text), Body Large =
  `text-base` (descriptions, prose), Label Large = `text-sm` (button labels —
  intentionally *not* bumped, this is the correct Material size already).
- **Theming**: light/dark via `next-themes` (`src/components/theme-provider.tsx`,
  toggle in the sidebar header). Colors are CSS custom properties in
  `globals.css` (`:root` / `.dark`) — primary brand color is `#11b67a` (light)
  / `#2fd696` (dark, brightened for contrast), with black text on all colored
  surfaces (`--primary-foreground: #000000`). Never hardcode colors in
  components; always go through the token (`bg-primary`, `text-foreground`,
  etc.) so both themes stay correct automatically.
- **No comments explaining what code does.** Only comment non-obvious *why*
  (a workaround, an invariant, a security consideration). This matches the
  existing codebase's style — keep it that way.

## Architecture (background on why things are shaped this way)

- **No permanent file storage.** Uploaded PDF bytes and fetched-URL HTML are
  never written to disk — they're base64/raw-text passed straight through the
  BullMQ job payload and discarded after the worker processes them. If you add
  a third resource type, follow the same pattern rather than introducing a
  file/blob store.
- **Resource metadata** lives in `data/resources.json` (gitignored), written
  only by the Next.js server process (`src/lib/resources/store.ts`). The
  **worker process never touches this file** — it only talks to Redis
  (BullMQ) and Qdrant. This separation avoids concurrent-write issues between
  the two processes. Job status is read live from BullMQ
  (`GET /api/resources/[id]/status`), not persisted separately.
- **Two long-running processes required for indexing to actually happen**:
  `bun run dev` (Next.js) and `bun run worker` (BullMQ consumer). Redis +
  Qdrant run via `bun run docker:up` (`docker-compose.yml`).
- **Resource types are a discriminated union** (`IndexResourceJobData` in
  `src/types/resource.ts`, `type: "pdf" | "url"`), dispatched in
  `src/worker/index.ts` by `job.data.type`. Adding a new resource type means:
  extend the union, add a `processXJob.ts` mirroring the existing shape
  (extract → chunk with the shared `chunkText()` → embed with the shared
  `embedTexts()` → `ensureCollection()` → upsert with a `sourceType` payload
  field), branch the dispatcher, and give `ResourceListItem` an icon for it.
- **Security**: any feature that fetches a user-supplied URL server-side must
  go through (or extend) `src/lib/web/fetchHtml.ts` — SSRF guard
  (`src/lib/web/ipGuard.ts`, rejects loopback/private/link-local IPs),
  timeout, size cap, content-type check. Don't add a second ad-hoc `fetch()`
  to an external URL without it.

## Running it locally

```
bun install
cp .env.local.example .env.local   # fill in OPENAI_API_KEY
bun run docker:up                  # redis + qdrant
bun run dev                        # terminal 1
bun run worker                     # terminal 2 — required for indexing to happen
```

Verify changes with `bunx tsc --noEmit` and `bun run lint` — both should be
clean before considering a change done. Prefer driving the actual feature
(curl the API, click through the UI) over trusting typecheck/lint alone, per
`plans/*.md`'s existing verification sections — follow that same standard for
new work.

## See also

- `plans/README.md` — the plan-file convention in full.
- `plans/001-pdf-upload-indexing-pipeline.md` — the core upload → queue →
  chunk → embed → Qdrant pipeline.
- `plans/002-ui-design-system.md` — theming, brand color, mobile layout,
  Material Design exploration.
- `plans/003-web-url-resource.md` — the URL resource type + SSRF guard.
