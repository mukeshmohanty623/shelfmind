import type { Job } from "bullmq";
import { v4 as uuidv4 } from "uuid";
import { chunkText } from "@/lib/pdf/chunkText";
import { embedTexts } from "@/lib/embeddings/openai";
import { getQdrantClient } from "@/lib/qdrant/client";
import { ensureCollection } from "@/lib/qdrant/ensureCollection";
import { env } from "@/lib/env";
import type {
  IndexTextJobData,
  IndexResourceJobData,
  IndexResourceJobResult,
} from "@/types/resource";

export async function processTextJob(
  job: Job<IndexResourceJobData, IndexResourceJobResult>,
): Promise<IndexResourceJobResult> {
  const { resourceId, userId, filename, text } = job.data as IndexTextJobData;

  await job.updateProgress(10);
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error(`Chunking produced no content for "${filename}"`);
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
        userId,
        sourceType: "text",
        filename,
        chunkIndex: index,
        text: chunk,
      },
    })),
  });

  await job.updateProgress(100);
  return { chunkCount: chunks.length };
}
