"use client";

import { useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { AddResourceModal, type UploadedResource } from "@/components/sidebar/AddResourceModal";
import { ResourceListItem } from "@/components/sidebar/ResourceListItem";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Resource } from "@/types/resource";

export function Sidebar({ onLinkClick }: { onLinkClick?: () => void } = {}) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/resources")
      .then((res) => res.json())
      .then((data: { resources: Resource[] }) => setResources(data.resources))
      .finally(() => setIsLoading(false));
  }, []);

  function handleUploaded(resource: UploadedResource) {
    setResources((prev) => [
      { ...resource, createdAt: new Date().toISOString() },
      ...prev,
    ]);
    onLinkClick?.();
  }

  function handleDeleted(id: string) {
    setResources((prev) => prev.filter((resource) => resource.id !== id));
  }

  return (
    <aside className="flex h-full w-full shrink-0 flex-col gap-4 border-r border-sidebar-border bg-sidebar p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading text-xl font-semibold text-sidebar-foreground">Noteboolm</span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserButton />
        </div>
      </div>

      <AddResourceModal onUploaded={handleUploaded} />

      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-1.5 pr-2">
            {isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}

            {!isLoading && resources.length === 0 && (
              <p className="px-2 py-6 text-center text-base text-muted-foreground">
                No resources yet. Add a PDF or web link to get started.
              </p>
            )}

            {resources.map((resource) => (
              <ResourceListItem
                key={resource.id}
                id={resource.id}
                filename={resource.filename}
                jobId={resource.jobId}
                sourceType={resource.sourceType}
                faviconUrl={resource.faviconUrl}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
    </aside>
  );
}
