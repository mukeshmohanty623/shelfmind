import type { Job } from "bullmq";
import { v4 as uuidv4 } from "uuid";
import { extractReadableText } from "@/lib/web/extractReadableText";
import { chunkText } from "@/lib/pdf/chunkText";
import { embedTexts } from "@/lib/embeddings/openai";
import { getQdrantClient } from "@/lib/qdrant/client";
import { ensureCollection } from "@/lib/qdrant/ensureCollection";
import { env } from "@/lib/env";
import type {
  IndexUrlJobData,
  IndexResourceJobData,
  IndexResourceJobResult,
} from "@/types/resource";

export async function processUrlJob(
  job: Job<IndexResourceJobData, IndexResourceJobResult>,
): Promise<IndexResourceJobResult> {
  const { resourceId, url, html } = job.data as IndexUrlJobData;

  await job.updateProgress(10);
  const { title, text } = extractReadableText(html, url);

  if (!text.trim()) {
    throw new Error(`No extractable text found at ${url}`);
  }

  await job.updateProgress(30);
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error(`Chunking produced no content for ${url}`);
  }

  await job.updateProgress(50);
  const vectors = await embedTexts(chunks);

  await job.updateProgress(80);
  await ensureCollection();

  const client = getQdrantClient();
  await client.upsert(env.qdrantCollection, {
    wait: true,
    points: chunks.map((chunk, index) => ({
      id: uuidv4(),
      vector: vectors[index],
      payload: {
        resourceId,
        sourceType: "url",
        sourceUrl: url,
        filename: title ?? url,
        chunkIndex: index,
        text: chunk,
      },
    })),
  });

  await job.updateProgress(100);
  return { chunkCount: chunks.length, title };
}
