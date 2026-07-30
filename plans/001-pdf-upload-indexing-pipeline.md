# PDF Upload → Queue → Chunk/Embed → Qdrant Indexing Pipeline

**Status:** done — core pipeline implemented and verified end-to-end (real PDFs uploaded via the UI, indexed, and confirmed in Qdrant).

## Context
The `noteboolm` app started as a freshly scaffolded Next.js 16 (App Router, TS, Tailwind,
bun) project with no custom code. The goal: let a user upload a PDF from the UI, have it
asynchronously chunked, embedded, and stored in Qdrant for later retrieval (RAG-style),
while the sidebar shows a shimmering "indexing" state until the job completes, polled
from the client.

Decisions:
- Embeddings: **OpenAI `text-embedding-3-small`** (`OPENAI_API_KEY` required)
- File storage: **no permanent disk storage** — the PDF buffer is passed through the
  queue (base64 in the BullMQ job payload) and discarded after processing
- Redis + Qdrant run locally via `docker-compose.yml`
- UI built with **shadcn/ui** (Dialog, Button, Skeleton, Sonner, ScrollArea)

## Architecture / Flow
1. UI: Sidebar "Add resource" button → dialog → pick a `.pdf` → submit.
2. `POST /api/resources` reads the file into memory, base64-encodes it, enqueues a
   BullMQ job (`index-pdf` queue) with `{ resourceId, filename, fileBase64 }`, and
   appends `{ id, filename, jobId, createdAt }` to a JSON-file resource registry
   (`data/resources.json`). Returns `{ id, jobId, filename }` immediately.
3. UI adds the resource to the sidebar right away with a shimmer state and starts
   polling `GET /api/resources/[jobId]/status` every ~2s.
4. A separate worker process (`bun run worker` → `src/worker/index.ts`) consumes the
   queue:
   - decode base64 → Buffer
   - extract text (`pdf-parse`'s `PDFParse` class)
   - chunk text (custom recursive splitter, ~1800 chars / 270 overlap — tuned
     2026-07-30 from the original 1000/150 defaults to align with the
     ~400-512 token / 1600-2000 char chunk size range recommended by current
     RAG chunking research, while keeping the ~15% overlap ratio)
   - embed chunks in batches of 100 via OpenAI
   - ensure Qdrant collection exists (lazy create, cosine distance, size 1536)
   - upsert points `{id: uuid, vector, payload: {resourceId, filename, chunkIndex, text}}`
   - reports progress via `job.updateProgress`, returns `{ chunkCount }` on success
5. Status endpoint reads job state directly from BullMQ (`queued|active|completed|failed`,
   progress, return value) — no separate status persistence, avoiding cross-process
   file writes from the worker.
6. When status hits `completed`/`failed`, the UI stops polling and updates the sidebar
   icon (checkmark / error), removing the shimmer.

## Folder layout
```
docker-compose.yml
.env.local.example
data/                              # gitignored, holds resources.json registry
plans/                             # this folder
src/
  app/
    page.tsx                       # renders <Sidebar/> + main content shell
    layout.tsx                     # adds <Toaster/>
    api/
      resources/
        route.ts                   # GET list, POST upload+enqueue
        [jobId]/status/route.ts    # GET job status (poll target)
  components/
    ui/                             # shadcn primitives
    sidebar/
      Sidebar.tsx
      ResourceListItem.tsx         # shimmer text vs. title+status icon, polls via hook
      AddResourceModal.tsx         # shadcn Dialog + Button, file picker/upload
  hooks/
    useResourcePolling.ts          # client hook: polls status until settled
  lib/
    queue/
      connection.ts                # shared ioredis connection (BullMQ)
      indexQueue.ts                # Queue instance + job name const
    qdrant/
      client.ts                    # QdrantClient singleton
      ensureCollection.ts
    pdf/
      extractText.ts               # pdf-parse wrapper
      chunkText.ts                 # recursive char splitter w/ overlap
    embeddings/
      openai.ts                    # embedTexts(texts): Promise<number[][]>
    resources/
      store.ts                     # JSON-file registry: list/add resource metadata
    env.ts                         # typed env accessor (throws on missing keys)
  worker/
    index.ts                       # BullMQ Worker bootstrap (run via `bun run worker`)
    processPdfJob.ts                # the actual job processor (extract→chunk→embed→upsert)
  types/
    resource.ts                    # shared Resource / JobStatus types
```

## package.json scripts
```
"worker": "bun --watch src/worker/index.ts",
"docker:up": "docker compose up -d",
"docker:down": "docker compose down"
```

## Env (`.env.local`, gitignored — copy from `.env.local.example`)
```
OPENAI_API_KEY=
REDIS_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=documents
```

## Task checklist
- [x] Install deps (`bullmq`, `ioredis`, `@qdrant/js-client-rest`, `pdf-parse`, `openai`,
      `uuid`) + `docker-compose.yml` (redis, qdrant) + shadcn init (button, dialog,
      skeleton, sonner, scroll-area)
- [x] Core libs: `env.ts`, queue connection/queue, qdrant client/ensureCollection,
      pdf extractText/chunkText, embeddings, resource JSON store, shared types
- [x] Worker process (`src/worker/index.ts` + `processPdfJob.ts`)
- [x] API routes: `POST/GET /api/resources`, `GET /api/resources/[jobId]/status`
- [x] UI: Sidebar, AddResourceModal (shadcn Dialog), ResourceListItem (shimmer via
      custom CSS `.shimmer-text` + `animate-spin` icon), polling hook, page shell,
      Toaster wired into layout
- [x] `bun run docker:up` confirmed redis + qdrant containers healthy
- [x] `tsc --noEmit` and `bun run lint` both clean
- [x] Add real `OPENAI_API_KEY` to `.env.local`
- [x] Live end-to-end test: ran `bun run dev` + `bun run worker`, uploaded two real PDFs
      via the UI, both completed, confirmed 255 points landed in the `documents` Qdrant
      collection (`curl localhost:6333/collections/documents`)
- [ ] Verify the error path (upload a non-PDF or corrupt file) surfaces a failed state
      in the sidebar instead of hanging
- [x] Tuned default chunk size/overlap in `chunkText.ts` from 1000/150 to
      1800/270 chars (research-backed: 400-512 token / ~15% overlap
      sweet spot for embedding-based retrieval). Shared by all three job
      processors (pdf/url/text) automatically — no other files changed.
      Note: only affects newly indexed content; existing Qdrant points keep
      their old chunk boundaries until the source is re-indexed.
- [x] Made PDF extraction page-aware for `plans/005` (query RAG pipeline):
      `extractText()` now returns `{ text, pages: { num, text }[] }` (using
      `pdf-parse`'s existing per-page output) instead of a flat string;
      `processPdfJob.ts` chunks each page separately and tags every chunk
      with a `page` payload field, so chat citations can show real page
      numbers. Chunks no longer span page boundaries (accepted tradeoff).
      URL/text jobs are unaffected and don't set `page`. Existing PDF points
      in Qdrant predate this and have no `page` field until re-indexed.

## How to run locally (any machine)
1. Install [bun](https://bun.sh) and Docker.
2. `bun install`
3. `cp .env.local.example .env.local` and fill in `OPENAI_API_KEY`.
4. `bun run docker:up` (starts redis + qdrant)
5. `bun run dev` (Next.js app) and, in a second terminal, `bun run worker` (BullMQ
   consumer) — both must be running for uploads to actually get indexed.
