import OpenAI from "openai";
import { env } from "@/lib/env";

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100;

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.openaiApiKey });
  }
  return client;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const openai = getClient();
  const vectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    vectors.push(...response.data.map((item) => item.embedding));
  }

  return vectors;
}
