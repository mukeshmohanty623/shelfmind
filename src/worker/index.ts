import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "@/lib/queue/connection";
import { INDEX_PDF_QUEUE_NAME } from "@/lib/queue/indexQueue";
import { processPdfJob } from "@/worker/processPdfJob";
import { processUrlJob } from "@/worker/processUrlJob";
import { processTextJob } from "@/worker/processTextJob";
import type { IndexResourceJobData, IndexResourceJobResult } from "@/types/resource";

function describeJob(data: IndexResourceJobData): string {
  if (data.type === "pdf") return data.filename;
  if (data.type === "url") return data.url;
  return data.filename;
}

function dispatchJob(
  job: Job<IndexResourceJobData, IndexResourceJobResult>,
): Promise<IndexResourceJobResult> {
  if (job.data.type === "pdf") return processPdfJob(job);
  if (job.data.type === "url") return processUrlJob(job);
  return processTextJob(job);
}

const worker = new Worker<IndexResourceJobData, IndexResourceJobResult>(
  INDEX_PDF_QUEUE_NAME,
  dispatchJob,
  { connection: getRedisConnection(), concurrency: 2 },
);

worker.on("completed", (job) => {
  console.log(`[worker] completed job ${job.id} (${describeJob(job.data)})`);
});

worker.on("failed", (job, err) => {
  console.error(
    `[worker] failed job ${job?.id} (${job ? describeJob(job.data) : "unknown"}):`,
    err.message,
  );
});

console.log(`[worker] listening on queue "${INDEX_PDF_QUEUE_NAME}"`);
