import { NextRequest, NextResponse } from "next/server";
import { getResource, removeResource } from "@/lib/resources/store";
import { deleteResourceVectors } from "@/lib/qdrant/deleteResourceVectors";
import { getIndexQueue } from "@/lib/queue/indexQueue";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const resource = await getResource(id);
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

  await deleteResourceVectors(id);
  await removeResource(id);

  return NextResponse.json({ ok: true });
}
