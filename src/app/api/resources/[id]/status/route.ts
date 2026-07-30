import { NextRequest, NextResponse } from "next/server";
import { getIndexQueue } from "@/lib/queue/indexQueue";
import type { ResourceStatusResponse, ResourceStatus } from "@/types/resource";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await params;
  const queue = getIndexQueue();
  const job = await queue.getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const state = await job.getState();
  const progress = typeof job.progress === "number" ? job.progress : 0;

  const statusMap: Record<string, ResourceStatus> = {
    completed: "completed",
    failed: "failed",
    active: "active",
    waiting: "queued",
    delayed: "queued",
    "waiting-children": "queued",
    prioritized: "queued",
    unknown: "queued",
  };

  const response: ResourceStatusResponse = {
    status: statusMap[state] ?? "queued",
    progress,
  };

  if (state === "completed") {
    response.chunkCount = job.returnvalue?.chunkCount;
  }

  if (state === "failed") {
    response.error = job.failedReason ?? "Indexing failed";
  }

  return NextResponse.json(response);
}
