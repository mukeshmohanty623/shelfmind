# Clerk Auth + Per-User Data Isolation

**Status:** in progress — code changes complete and typecheck/lint clean;
end-to-end sign-up/isolation verification and legacy-data migration still to
be run against the live stack.

## Context

shelfmind had zero auth: anyone who could reach the app saw every uploaded
resource, and chat could retrieve any resource's vectors regardless of who
uploaded them, because there was one global `data/resources.json` and one
global Qdrant collection with no owner field. The ask was real login (Clerk,
email+password only — no social/passwordless) plus hard per-user isolation:
each signed-in user only ever sees/uploads/chats over their own resources.
Pre-existing (pre-auth) resources and vectors are reassigned to whichever
user signs up first, via a one-off migration script, rather than wiped.

## Architecture / Flow

- **Provisioning**: a dedicated Clerk application ("shelfmind",
  `app_3HFnOHswZBNyQ57GZPDWV10QxCS`) was created and linked via the Clerk CLI
  (`clerk apps create` → `clerk link --app` → `clerk env pull`), which wrote
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` into `.env.local`.
  **Manual step, not done by the agent**: in the Clerk Dashboard, disable
  every sign-in strategy except Email address + Password (not
  CLI-scriptable).
- **Gating**: `proxy.ts` (repo root — Next.js 16 renamed `middleware.ts` →
  `proxy.ts`) uses `clerkMiddleware()` with `createRouteMatcher(["/api/resources(.*)", "/api/chat(.*)"])`
  and calls `auth.protect()` only for those matches, so the two API surfaces
  401 when signed out without hard-redirecting the root page. `src/app/page.tsx`
  gates the UI itself with `<Show when="signed-in">` (renders the existing
  `AppShell`/`ChatPanel`) / `<Show when="signed-out">` (renders `<SignIn/>`
  inline) from `@clerk/nextjs` — **not** the deprecated `<SignedIn>`/`<SignedOut>`,
  which this installed version (`@clerk/nextjs@7.6.3`) doesn't export at all.
- **Isolation**: kept the single global Qdrant collection (no per-user
  collections) and added a `userId` payload field to every point, filtered
  on at query time exactly like the existing `resourceId` scoping in
  `retrieve.ts`. Same idea for `data/resources.json`: `Resource.userId` +
  every `store.ts` read filtered by it.
- **Ownership checks return 404, not 403**, for another user's resource id
  (`getResource`/`removeResource` simply don't find it), so existence isn't
  leaked. `GET /api/resources/[id]/status` takes a **jobId**, not a
  resourceId — added `getResourceByJobId(jobId, userId)` to `store.ts` so
  ownership is checked against `resources.json` (source of truth) before the
  BullMQ job lookup is trusted.
- Chat turned out to be a **direct SSE call** from `api/chat/route.ts` (the
  queue-based `processChatJob.ts`/`ChatJobData` from an earlier planning pass
  no longer exists — `plans/007`'s fallback-tiers work reverted chat to a
  direct call), which simplified the threading: `auth()` in the route,
  `userId` passed straight into `answerWithRetry(query, history, userId, callbacks)`
  → `retrieveContext(variants, rawQuery, userId)`.

## Files touched

- `proxy.ts` — new, `clerkMiddleware()` + route-matched `auth.protect()`.
- `src/types/resource.ts` — `Resource.userId`; `IndexPdfJobData` /
  `IndexUrlJobData` / `IndexTextJobData` each gained `userId`.
- `src/lib/resources/store.ts` — `listResources(userId)`, `getResource(id, userId)`,
  `removeResource(id, userId)` ownership-filtered; new `getResourceByJobId(jobId, userId)`.
- `src/app/api/resources/route.ts` — `GET`/`POST` require `auth()`; each
  `handle*Resource` helper takes `userId`, threads it into the BullMQ job
  payload, `addResource`, and the JSON response (needed client-side so the
  Sidebar's optimistic local-state update still satisfies `Resource`'s
  required `userId`).
- `src/app/api/resources/[id]/route.ts` — `DELETE` requires `auth()`,
  ownership-checked via `getResource`/`deleteResourceVectors`/`removeResource`.
- `src/app/api/resources/[id]/status/route.ts` — requires `auth()`, verifies
  ownership via `getResourceByJobId` before trusting the BullMQ job lookup.
- `src/app/api/chat/route.ts` — requires `auth()`, passes `userId` into
  `answerWithRetry`.
- `src/worker/processPdfJob.ts` / `processUrlJob.ts` / `processTextJob.ts` —
  read `userId` off `job.data`, write it into the Qdrant upsert payload.
- `src/lib/qdrant/deleteResourceVectors.ts` — signature is now
  `(resourceId, userId)`, filter requires both (defense in depth).
- `src/lib/rag/retrieve.ts` — `retrieveContext(variants, rawQuery, userId)`;
  `ChunkPayload` gained `userId`; `listResources(userId)`; `userId` match
  filter added to both the main `searchBatch` call and the forced
  filename/recency `search` call; `getResource(chunk.resourceId, userId)`.
- `src/lib/rag/answerWithRetry.ts` — `answerWithRetry(query, history, userId, callbacks)`,
  threads `userId` into both `retrieveContext` calls.
- `src/app/layout.tsx` — `ClerkProvider` (with `appearance={{ theme: shadcn }}`
  from `@clerk/ui/themes`) inside `<body>`, wrapping the existing
  `ThemeProvider`.
- `src/app/globals.css` — `@import '@clerk/ui/themes/shadcn.css';`.
- `src/app/page.tsx` — `<Show when="signed-in">`/`<Show when="signed-out">` gating.
- `src/components/sidebar/Sidebar.tsx` — `<UserButton/>` next to the existing
  `<ThemeToggle/>` in the header row (no `afterSignOutUrl` prop — it doesn't
  exist on this installed version's `UserButtonProps`).
- `src/components/sidebar/AddResourceModal.tsx` — `UploadedResource` gained
  `userId` to match the `Resource` shape used for the optimistic sidebar
  update.
- `scripts/migrate-legacy-data.ts` — new, one-off: `bun scripts/migrate-legacy-data.ts <clerkUserId>`.
  Assigns `userId` to every `data/resources.json` entry missing one, and
  bulk-assigns it to every Qdrant point missing a `userId` payload field via
  `setPayload` with an `is_empty` filter (no scroll+upsert needed).
- `.env.local.example` — added `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=` /
  `CLERK_SECRET_KEY=` placeholders.
- `package.json` / `bun.lock` — `@clerk/nextjs`, `@clerk/ui` added via `bun add`.

## Follow-up fix: multi-entity filename matching

While verifying isolation, found (and fixed, unrelated to auth) that
`retrieve.ts`'s `findFilenameMatches` only force-included a resource when its
**entire** filename stem appeared verbatim in the query. For compound-name
files like `Preeti_Raikwar_2026.pdf`, a question like "tell me about mukesh
and Preeti" only force-matched `mukesh.pdf` (whose whole stem is one word),
never the Preeti resource — leaving only one resume in context, which the
judge treated as an incomplete answer and routed to the general-knowledge
fallback tier instead. Verified this was a pre-existing retrieval-quality gap
predating the auth work, not a regression from `userId` filtering (semantic
scores for both resumes on this query were ~0.31-0.33, below
`SCORE_THRESHOLD`/`MIN_SECONDARY_SCORE` either way).

Fix: `findFilenameMatches` now also matches when any single significant word
from the filename stem (split on non-alphanumeric separators, same
`MIN_FILENAME_TOKEN_LENGTH` floor) appears as a whole word in the query,
alongside the existing full-stem-substring check. Verified directly against
Qdrant (bypassing the UI) that "Tell me about mukesh and Preeti" now
force-includes both `mukesh.pdf` and `Preeti_Raikwar_2026.pdf`.

## Task checklist

- [x] Clerk CLI installed, logged in, app created + linked, env pulled
- [x] `proxy.ts` protecting `/api/resources` and `/api/chat`
- [x] `Resource` / job-data types gain `userId`
- [x] `store.ts` ownership-scoped (`listResources`, `getResource`,
      `removeResource`, new `getResourceByJobId`)
- [x] API routes (`resources`, `[id]`, `[id]/status`, `chat`) require auth
      and scope by `userId`
- [x] Worker processors write `userId` into the Qdrant payload
- [x] `deleteResourceVectors` scoped by `resourceId` + `userId`
- [x] `retrieve.ts` / `answerWithRetry.ts` thread `userId` through retrieval
      and the Qdrant filters
- [x] `layout.tsx` / `globals.css` / `page.tsx` / `Sidebar.tsx` wired for
      Clerk (`ClerkProvider`, shadcn theme, `<Show>` gating, `<UserButton/>`)
- [x] `scripts/migrate-legacy-data.ts` written
- [x] `bunx tsc --noEmit` and `bun run lint` clean
- [ ] **Manual, user-side**: disable all Clerk sign-in strategies except
      Email + Password in the Clerk Dashboard
- [ ] Drive end-to-end: sign up as user A, upload a resource, confirm it's
      visible/citable; sign up as user B, confirm B sees nothing of A's and
      can't retrieve it via chat
- [ ] Confirm `/api/resources` and `/api/chat` 401 when signed out
- [ ] Confirm cross-user `DELETE`/status-poll on another user's id/jobId 404s
- [ ] Run `scripts/migrate-legacy-data.ts <userId>` once a first real user
      exists, if there's pre-existing `resources.json`/Qdrant data to migrate

## Verification

`bunx tsc --noEmit` and `bun run lint` both pass clean as of this write-up.
Remaining verification is end-to-end and requires the full stack running
(`bun run docker:up`, `bun run dev`, `bun run worker`) plus two real Clerk
sign-ups — see the unchecked items above.
