"use client";

import { useEffect, useRef, useState } from "react";
import type { ResourceStatusResponse } from "@/types/resource";

const POLL_INTERVAL_MS = 2000;

export function useResourcePolling(jobId: string) {
  // Starts unknown rather than defaulting to "queued" — most resources loaded on a page
  // refresh already finished indexing long ago, and assuming "queued" makes them flash
  // an "Indexing..." state for every already-completed resource until the first poll
  // resolves.
  const [status, setStatus] = useState<ResourceStatusResponse | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/resources/${jobId}/status`);
        if (!res.ok) throw new Error("Failed to fetch status");
        const data: ResourceStatusResponse = await res.json();
        if (cancelled) return;

        setStatus(data);

        if (data.status === "completed" || data.status === "failed") {
          settled.current = true;
          return;
        }
      } catch {
        // transient poll failure — keep retrying
      }

      if (!cancelled && !settled.current) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  return status;
}
