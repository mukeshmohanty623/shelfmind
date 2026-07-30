# shelfmind

A NotebookLM-style app: upload PDFs, paste web links or plain text, and chat
over them. Sources are chunked, embedded, and indexed into a vector store via
a background job queue, then retrieved and cited when you ask questions.

## Features

- **Multiple source types** — PDF upload, web URL, or raw pasted text, each
  indexed through the same chunk → embed → store pipeline.
- **Background indexing** — uploads are queued (BullMQ/Redis) and processed by
  a separate worker, so the UI stays responsive; resource status polls live
  from the queue (`queued` → `active` → `completed`/`failed`).
- **Grounded chat with citations** — questions are answered only from
  retrieved excerpts, with pinpoint citations back to the source chunk. A
  retry loop re-evaluates weak answers, and out-of-scope questions get a
  deterministic decline instead of a hallucinated one.
- **No permanent file storage** — uploaded bytes/HTML are streamed straight
  through the job payload and discarded after indexing; nothing touches disk.

## Stack

Next.js 16 (App Router) + TypeScript + Tailwind v4, shadcn/ui, BullMQ +
Redis for the job queue, Qdrant for vector storage, OpenAI for embeddings and
chat. Package manager is [bun](https://bun.sh).

## Running locally

```bash
bun install
cp .env.local.example .env.local   # fill in OPENAI_API_KEY
bun run docker:up                  # starts redis + qdrant
bun run dev                        # terminal 1 — Next.js
bun run worker                     # terminal 2 — required for indexing to happen
```

Open [http://localhost:3000](http://localhost:3000). Both `dev` and `worker`
need to stay running for uploads to actually get indexed.

### Environment variables

| Variable            | Purpose                              | Default                  |
| ------------------- | ------------------------------------- | ------------------------ |
| `OPENAI_API_KEY`     | Embeddings + chat completions         | *(required)*             |
| `REDIS_URL`          | BullMQ job queue                      | `redis://localhost:6379` |
| `QDRANT_URL`         | Vector store                          | `http://localhost:6333`  |
| `QDRANT_COLLECTION`  | Qdrant collection name                | `documents`               |

### Other scripts

```bash
bun run lint          # eslint
bunx tsc --noEmit      # typecheck
bun run docker:down    # stop redis + qdrant
```

## Architecture notes

Deeper design decisions (why resources aren't stored on disk, why the worker
never touches `data/resources.json`, the retrieval/retry/citation pipeline,
etc.) are written up as they're built in [`plans/`](./plans) — see
[`plans/README.md`](./plans/README.md) for the convention, and
[`CLAUDE.md`](./CLAUDE.md) for the full set of stack/architecture notes.
