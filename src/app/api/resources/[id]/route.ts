import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getResource, removeResource } from "@/lib/resources/store";
import { deleteResourceVectors } from "@/lib/qdrant/deleteResourceVectors";
import { getIndexQueue } from "@/lib/queue/indexQueue";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const resource = await getResource(id, userId);
  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  const queue = getIndexQueue();
  const job = await queue.getJob(resource.jobId);
  if (job) {
    try {
      await job.remove();
    } catch {
      // job may already be locked/active — safe to ignore, vectors are cleaned up below regardless
    }
  }

  await deleteResourceVectors(id, userId);
  await removeResource(id, userId);

  return NextResponse.json({ ok: true });
}
