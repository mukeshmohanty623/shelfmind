import { getQdrantClient } from "@/lib/qdrant/client";
import { env } from "@/lib/env";

export async function deleteResourceVectors(resourceId: string): Promise<void> {
  const client = getQdrantClient();
  const { exists } = await client.collectionExists(env.qdrantCollection);
  if (!exists) return;

  await client.delete(env.qdrantCollection, {
    wait: true,
    filter: {
      must: [{ key: "resourceId", match: { value: resourceId } }],
    },
  });
}
