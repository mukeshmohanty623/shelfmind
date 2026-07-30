import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "@/lib/env";

let client: QdrantClient | undefined;

export function getQdrantClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({ url: env.qdrantUrl });
  }
  return client;
}
