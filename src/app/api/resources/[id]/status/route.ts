import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getIndexQueue } from "@/lib/queue/indexQueue";
import { getResourceByJobId } from "@/lib/resources/store";
import type { ResourceStatusResponse, ResourceStatus } from "@/types/resource";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: jobId } = await params;

  const resource = await getResourceByJobId(jobId, userId);
  if (!resource) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

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
