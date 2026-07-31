import { embedTexts } from "@/lib/embeddings/openai";
import { getQdrantClient } from "@/lib/qdrant/client";
import { env } from "@/lib/env";
import { getResource, listResources } from "@/lib/resources/store";
import type { Resource, ResourceSourceType } from "@/types/resource";

const SEARCH_LIMIT_PER_VARIANT = 8;
const TOP_K_RESOURCES = 5;
// Cosine similarity floor for text-embedding-3-small: unrelated text still scores
// ~0.2-0.3 against any corpus, genuinely relevant matches score ~0.4+. Filtering below
// this avoids citing "sources" the answer didn't actually draw from.
const SCORE_THRESHOLD = 0.35;
// HyDE/sub-questions can hallucinate plausible-sounding content for entities the small
// LLM doesn't know (e.g. a person's name), and that hallucination can drift close enough
// to an unrelated but topically-adjacent document to clear SCORE_THRESHOLD on its own.
// Dropping anything too far below the single best match filters that drift out while
// still allowing genuinely co-relevant secondary sources through.
const MAX_SCORE_MARGIN = 0.15;
// MAX_SCORE_MARGIN alone isn't enough: when the top score itself is weak (near
// SCORE_THRESHOLD, meaning no resource is a confident match), several unrelated
// resources can cluster within the margin of each other purely from generic language
// overlap, and all get pulled in as "secondary" sources. Requiring secondary sources to
// also clear an absolute confidence bar — not just be close to a weak leader — avoids
// that. The single top scorer is always kept regardless (it already cleared
// SCORE_THRESHOLD at search time).
const MIN_SECONDARY_SCORE = 0.45;
// Exact IDs/codes/titles (e.g. "ACK106099170300526") don't embed distinctively —
// dense similarity search can miss them even when the literal string is right there in
// the query and a resource's filename. Below this length a match is too likely to be a
// coincidental common word/substring to trust as a filename match.
const MIN_FILENAME_TOKEN_LENGTH = 4;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findFilenameMatches(rawQuery: string, resources: Resource[]): Resource[] {
  const normalizedQuery = normalize(rawQuery);
  const queryTokens = new Set(
    rawQuery
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map(normalize),
  );

  return resources.filter((resource) => {
    const stem = resource.filename.replace(/\.[a-z0-9]+$/i, "");
    const normalizedStem = normalize(stem);
    if (normalizedStem.length >= MIN_FILENAME_TOKEN_LENGTH && normalizedQuery.includes(normalizedStem)) {
      return true;
    }

    // Compound filenames (e.g. "Preeti_Raikwar_2026.pdf") also match on any single
    // significant word from the stem, so a multi-entity question ("tell me about X and
    // Y") force-includes a resource even when only part of its filename is mentioned,
    // rather than requiring the full stem to appear verbatim.
    const stemTokens = stem
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map(normalize);
    return stemTokens.some(
      (token) => token.length >= MIN_FILENAME_TOKEN_LENGTH && queryTokens.has(token),
    );
  });
}

// Phrases that reference "the thing I just uploaded" by recency, not by name. These
// have no filename for findFilenameMatches to catch, and (worse) send pure-semantic
// ranking chasing a HyDE hallucination for a query with no real topic — resolving them
// deterministically from listResources()'s existing recency order sidesteps both.
// The recency word and the upload verb are often separated by the resource noun
// ("latest doc I have uploaded", "most recent file I added"), so each pattern allows a
// short gap rather than requiring adjacency.
const RECENCY_NOUNS = "docs?|documents?|files?|pdfs?|uploads?|resources?|links?|urls?|websites?|videos?|notes?|articles?|ones?";
const RECENCY_PHRASE = new RegExp(
  [
    // "just/recently/lately uploaded/added/indexed"
    `\\b(?:just|recently|lately)\\s+(?:uploaded|added|imported|indexed)\\b`,
    // "latest/last/newest/most recent [up to 3 words] <resource noun>"
    `\\b(?:latest|last|newest|most\\s+recent(?:ly)?)\\s+(?:\\w+\\s+){0,3}?(?:${RECENCY_NOUNS})\\b`,
    // "latest/last/newest/most recent [up to 4 words] I (just/recently/have) uploaded/added"
    `\\b(?:latest|last|newest|most\\s+recent(?:ly)?)\\b(?:\\s+\\w+){0,4}?\\s+i\\s+(?:just\\s+|recently\\s+|have\\s+|'?ve\\s+)?(?:uploaded|added|imported)\\b`,
    // "upload(ed)/add(ed) [up to 2 words] recently/lately/just now/last/most recently"
    `\\b(?:upload(?:ed)?|add(?:ed)?|import(?:ed)?|indexed)\\s+(?:\\w+\\s+){0,2}(?:most\\s+recently|recently|lately|just\\s+now|last)\\b`,
  ].join("|"),
  "i",
);

const TYPE_KEYWORDS: { pattern: RegExp; sourceType: ResourceSourceType }[] = [
  { pattern: /\bpdf\b/i, sourceType: "pdf" },
  { pattern: /\b(link|url|website|webpage|web\s*page|article)\b/i, sourceType: "url" },
  { pattern: /\b(note|text\s*(file|snippet)?)\b/i, sourceType: "text" },
];

function findRecencyMatch(rawQuery: string, resources: Resource[]): Resource | undefined {
  if (!RECENCY_PHRASE.test(rawQuery)) return undefined;

  const typeMatch = TYPE_KEYWORDS.find(({ pattern }) => pattern.test(rawQuery));
  const candidates = typeMatch
    ? resources.filter((resource) => resource.sourceType === typeMatch.sourceType)
    : resources;

  // resources is already sorted most-recent-first by listResources().
  return candidates[0];
}

interface ChunkPayload {
  resourceId: string;
  userId: string;
  sourceType: ResourceSourceType;
  filename: string;
  sourceUrl?: string;
  chunkIndex: number;
  page?: number;
  text: string;
}

export interface RetrievedChunk {
  resourceId: string;
  filename: string;
  sourceType: ResourceSourceType;
  sourceUrl?: string;
  chunkIndex: number;
  page?: number;
  text: string;
  score: number;
}

export async function retrieveContext(
  variants: string[],
  rawQuery: string,
  userId: string,
): Promise<RetrievedChunk[]> {
  const uniqueVariants = [...new Set(variants.map((v) => v.trim()).filter(Boolean))];
  if (uniqueVariants.length === 0) return [];

  const [vectors, resources] = await Promise.all([
    embedTexts(uniqueVariants),
    listResources(userId),
  ]);
  const queryVectorIndex = uniqueVariants.indexOf(rawQuery.trim());
  const queryVector = vectors[queryVectorIndex] ?? vectors[0];

  const client = getQdrantClient();
  const batches = await client.searchBatch(env.qdrantCollection, {
    searches: vectors.map((vector) => ({
      vector,
      limit: SEARCH_LIMIT_PER_VARIANT,
      with_payload: true,
      score_threshold: SCORE_THRESHOLD,
      filter: { must: [{ key: "userId", match: { value: userId } }] },
    })),
  });

  const bestByResource = new Map<string, RetrievedChunk>();

  for (const results of batches) {
    for (const point of results) {
      const payload = point.payload as unknown as ChunkPayload | undefined;
      if (!payload) continue;

      const existing = bestByResource.get(payload.resourceId);
      if (existing && existing.score >= point.score) continue;

      bestByResource.set(payload.resourceId, {
        resourceId: payload.resourceId,
        filename: payload.filename,
        sourceType: payload.sourceType,
        sourceUrl: payload.sourceUrl,
        chunkIndex: payload.chunkIndex,
        page: payload.page,
        text: payload.text,
        score: point.score,
      });
    }
  }

  const filenameMatches = findFilenameMatches(rawQuery, resources);
  const recencyMatch = findRecencyMatch(rawQuery, resources);
  const explicitMatches = [
    ...filenameMatches,
    ...(recencyMatch && !filenameMatches.some((r) => r.id === recencyMatch.id)
      ? [recencyMatch]
      : []),
  ];
  const forced = (
    await Promise.all(
      explicitMatches.map(async (resource): Promise<RetrievedChunk | undefined> => {
        const [hit] = await client.search(env.qdrantCollection, {
          vector: queryVector,
          limit: 1,
          filter: {
            must: [
              { key: "resourceId", match: { value: resource.id } },
              { key: "userId", match: { value: userId } },
            ],
          },
          with_payload: true,
        });
        if (!hit) return undefined;
        const payload = hit.payload as unknown as ChunkPayload;
        return {
          resourceId: resource.id,
          filename: resource.filename,
          sourceType: resource.sourceType,
          sourceUrl: resource.sourceUrl,
          chunkIndex: payload.chunkIndex,
          page: payload.page,
          text: payload.text,
          score: hit.score,
        };
      }),
    )
  ).filter((chunk): chunk is RetrievedChunk => chunk !== undefined);

  const forcedIds = new Set(forced.map((chunk) => chunk.resourceId));
  const byScoreDesc = [...bestByResource.values()]
    .filter((chunk) => !forcedIds.has(chunk.resourceId))
    .sort((a, b) => b.score - a.score);

  // Once a filename match has definitively answered "which resource", any semantic
  // hits alongside it have to clear the same confidence bar as a normal secondary
  // source — no automatic top-scorer pass-through, since for these lookup-style
  // queries the LLM's generic HyDE/step-back phrasing can occasionally out-score the
  // actual document on unrelated resources (see plans/005 write-up).
  const [topResult, ...restResults] = byScoreDesc;
  const maxScore = topResult?.score ?? 0;
  const semanticRanked =
    forced.length > 0
      ? byScoreDesc.filter((chunk) => chunk.score >= MIN_SECONDARY_SCORE)
      : topResult
        ? [
            topResult,
            ...restResults.filter(
              (chunk) =>
                chunk.score >= maxScore - MAX_SCORE_MARGIN && chunk.score >= MIN_SECONDARY_SCORE,
            ),
          ]
        : [];

  const ranked = [...forced, ...semanticRanked].slice(0, TOP_K_RESOURCES);

  const resolved = await Promise.all(
    ranked.map(async (chunk) => {
      const resource = await getResource(chunk.resourceId, userId);
      if (!resource) return chunk;
      return {
        ...chunk,
        filename: resource.filename,
        sourceType: resource.sourceType,
        sourceUrl: resource.sourceUrl,
      };
    }),
  );

  return resolved;
}
