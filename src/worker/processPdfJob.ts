import type { Job } from "bullmq";
import { v4 as uuidv4 } from "uuid";
import { extractText } from "@/lib/pdf/extractText";
import { chunkText } from "@/lib/pdf/chunkText";
import { embedTexts } from "@/lib/embeddings/openai";
import { getQdrantClient } from "@/lib/qdrant/client";
import { ensureCollection } from "@/lib/qdrant/ensureCollection";
import { env } from "@/lib/env";
import type {
  IndexPdfJobData,
  IndexResourceJobData,
  IndexResourceJobResult,
} from "@/types/resource";

export async function processPdfJob(
  job: Job<IndexResourceJobData, IndexResourceJobResult>,
): Promise<IndexResourceJobResult> {
  const { resourceId, filename, fileBase64 } = job.data as IndexPdfJobData;

  await job.updateProgress(10);
  const buffer = Buffer.from(fileBase64, "base64");
  const extracted = await extractText(buffer);

  if (!extracted.text.trim()) {
    throw new Error(`No extractable text found in "${filename}"`);
  }

  await job.updateProgress(30);
  const chunks: { text: string; page: number }[] = [];
  for (const page of extracted.pages) {
    if (!page.text.trim()) continue;
    for (const chunk of chunkText(page.text)) {
      chunks.push({ text: chunk, page: page.num });
    }
  }
  if (chunks.length === 0) {
    throw new Error(`Chunking produced no content for "${filename}"`);
  }

  await job.updateProgress(50);
  const vectors = await embedTexts(chunks.map((chunk) => chunk.text));

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
        sourceType: "pdf",
        filename,
        chunkIndex: index,
        page: chunk.page,
        text: chunk.text,
      },
    })),
  });

  await job.updateProgress(100);
  return { chunkCount: chunks.length };
}
