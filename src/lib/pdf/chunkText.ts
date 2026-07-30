export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

const DEFAULT_CHUNK_SIZE = 1800;
const DEFAULT_CHUNK_OVERLAP = 270;

/**
 * Splits text into overlapping chunks, preferring to break on paragraph/sentence
 * boundaries near the target size rather than cutting mid-word.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    if (end < normalized.length) {
      const boundary = findBreakBoundary(normalized, start, end);
      if (boundary > start) end = boundary;
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= normalized.length) break;
    start = Math.max(end - chunkOverlap, start + 1);
  }

  return chunks;
}

function findBreakBoundary(text: string, start: number, end: number): number {
  const window = text.slice(start, end);
  const candidates = [
    window.lastIndexOf("\n\n"),
    window.lastIndexOf(". "),
    window.lastIndexOf("\n"),
    window.lastIndexOf(" "),
  ];

  for (const idx of candidates) {
    if (idx > window.length * 0.4) {
      return start + idx + 1;
    }
  }

  return end;
}
