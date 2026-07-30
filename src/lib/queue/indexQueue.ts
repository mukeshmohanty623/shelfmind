import { Queue } from "bullmq";
import { getRedisConnection } from "@/lib/queue/connection";
import type { IndexResourceJobData, IndexResourceJobResult } from "@/types/resource";

export const INDEX_PDF_QUEUE_NAME = "index-pdf";

let queue: Queue<IndexResourceJobData, IndexResourceJobResult> | undefined;

export function getIndexQueue(): Queue<IndexResourceJobData, IndexResourceJobResult> {
  if (!queue) {
    queue = new Queue<IndexResourceJobData, IndexResourceJobResult>(INDEX_PDF_QUEUE_NAME, {
      connection: getRedisConnection(),
    });
  }
  return queue;
}
