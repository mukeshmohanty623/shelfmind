import { getQdrantClient } from "@/lib/qdrant/client";
import { env } from "@/lib/env";

export const EMBEDDING_VECTOR_SIZE = 1536; // text-embedding-3-small

let ensured = false;

export async function ensureCollection(): Promise<void> {
  if (ensured) return;

  const client = getQdrantClient();
  const { exists } = await client.collectionExists(env.qdrantCollection);

  if (!exists) {
    await client.createCollection(env.qdrantCollection, {
      vectors: {
        size: EMBEDDING_VECTOR_SIZE,
        distance: "Cosine",
      },
    });
  }

  ensured = true;
}
