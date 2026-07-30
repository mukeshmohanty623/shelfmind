function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get openaiApiKey() {
    return required("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
  },
  get redisUrl() {
    return process.env.REDIS_URL ?? "redis://localhost:6379";
  },
  get qdrantUrl() {
    return process.env.QDRANT_URL ?? "http://localhost:6333";
  },
  get qdrantCollection() {
    return process.env.QDRANT_COLLECTION ?? "documents";
  },
};
