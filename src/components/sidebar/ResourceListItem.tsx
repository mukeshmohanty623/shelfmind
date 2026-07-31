"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";
import type { ResourceSourceType } from "@/types/resource";
import { SOURCE_TYPE_META } from "@/lib/resources/sourceTypeMeta";
import { useResourcePolling } from "@/hooks/useResourcePolling";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function ResourceListItem({
  id,
  filename,
  jobId,
  sourceType,
  faviconUrl,
  onDeleted,
}: {
  id: string;
  filename: string;
  jobId: string;
  sourceType: ResourceSourceType;
  faviconUrl?: string;
  onDeleted: (id: string) => void;
}) {
  const polled = useResourcePolling(jobId);
  const status = polled?.status;
  const error = polled?.error;
  const isIndexing = status === "queued" || status === "active";
  const [isDeleting, setIsDeleting] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const { icon: Icon, colorClass } = SOURCE_TYPE_META[sourceType] ?? SOURCE_TYPE_META.pdf;
  const showFavicon = sourceType === "url" && faviconUrl && !faviconFailed;

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/resources/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete resource");
      onDeleted(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete resource");
      setIsDeleting(false);
    }
  }

  return (
    <div className="group relative flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-sidebar-accent">
      {showFavicon ? (
        // eslint-disable-next-line @next/next/no-img-element -- favicon is an arbitrary external URL, not an optimizable local asset
        <img
          src={faviconUrl}
          alt=""
          className={cn(
            "size-5 shrink-0 rounded-sm object-contain",
            isIndexing && "animate-pulse opacity-50",
          )}
          onError={() => setFaviconFailed(true)}
        />
      ) : (
        <Icon
          className={cn(
            "size-5 shrink-0",
            colorClass,
            isIndexing && "animate-pulse opacity-50",
            status === "failed" && "text-destructive",
          )}
        />
      )}

      <div className="min-w-0 flex-1 transition-[padding] group-hover:pr-9 group-focus-within:pr-9">
        {isIndexing ? (
          <span className="shimmer-text block truncate text-base font-medium" title={filename}>
            {filename}
          </span>
        ) : (
          <span
            className={cn(
              "block truncate text-base font-medium",
              status === "failed" && "text-destructive",
            )}
            title={status === "failed" ? error : filename}
          >
            {filename}
          </span>
        )}
        {isIndexing && (
          <span className="block truncate text-sm text-muted-foreground">
            Indexing...
          </span>
        )}
        {status === "failed" && (
          <span className="block truncate text-sm text-destructive/80">
            {error ?? "Indexing failed"}
          </span>
        )}
      </div>

      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${filename}`}
              disabled={isDeleting}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
            />
          }
        >
          <Trash2Icon />
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete resource?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes &ldquo;{filename}&rdquo; and its indexed content from Qdrant.
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
