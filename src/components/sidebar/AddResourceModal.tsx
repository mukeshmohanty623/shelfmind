"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PlusIcon, FileTextIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SOURCE_TYPE_META } from "@/lib/resources/sourceTypeMeta";
import type { ResourceSourceType } from "@/types/resource";

const MODES: ResourceSourceType[] = ["pdf", "url", "text"];

const MAX_TEXT_LENGTH = 100_000;

export interface UploadedResource {
  id: string;
  userId: string;
  jobId: string;
  filename: string;
  sourceType: ResourceSourceType;
  sourceUrl?: string;
  faviconUrl?: string;
}

function isLikelyUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function AddResourceModal({
  onUploaded,
}: {
  onUploaded: (resource: UploadedResource) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ResourceSourceType>("pdf");
  const [file, setFile] = useState<File | null>(null);
  const [urlValue, setUrlValue] = useState("");
  const [textValue, setTextValue] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    setFile(selected ?? null);
  }

  function resetForm() {
    setFile(null);
    setUrlValue("");
    setTextValue("");
    setTextTitle("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleSubmit() {
    setIsUploading(true);
    try {
      const formData = new FormData();
      if (mode === "pdf") {
        if (!file) return;
        formData.append("file", file);
      } else if (mode === "url") {
        if (!isLikelyUrl(urlValue)) return;
        formData.append("url", urlValue.trim());
      } else {
        const trimmed = textValue.trim();
        if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) return;
        formData.append("text", trimmed);
        if (textTitle.trim()) formData.append("title", textTitle.trim());
      }

      const res = await fetch("/api/resources", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to add resource");
      }

      const data: UploadedResource = await res.json();
      onUploaded(data);
      setOpen(false);
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add resource");
    } finally {
      setIsUploading(false);
    }
  }

  const canSubmit =
    mode === "pdf"
      ? !!file
      : mode === "url"
        ? isLikelyUrl(urlValue)
        : textValue.trim().length > 0 && textValue.trim().length <= MAX_TEXT_LENGTH;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="secondary" className="w-full justify-start">
            <PlusIcon data-icon="inline-start" />
            Add resource
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add resource</DialogTitle>
          <DialogDescription>
            Upload a PDF, add a web link, or paste text to chunk, embed, and index it for retrieval.
          </DialogDescription>
        </DialogHeader>

        <div className="inline-flex items-center gap-1 self-start rounded-lg bg-muted p-1">
          {MODES.map((m) => {
            const { icon: ModeIcon, colorClass, label } = SOURCE_TYPE_META[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <ModeIcon className={cn("size-4", mode === m && colorClass)} />
                {label}
              </button>
            );
          })}
        </div>

        {mode === "pdf" ? (
          <label
            htmlFor="pdf-upload"
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-center hover:bg-muted/50"
          >
            <FileTextIcon className="size-6 text-source-pdf" />
            <span className="text-base text-muted-foreground">
              {file ? file.name : "Click to choose a PDF file"}
            </span>
            <input
              id="pdf-upload"
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
        ) : mode === "url" ? (
          <input
            type="url"
            inputMode="url"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            placeholder="https://example.com/article"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={textTitle}
              onChange={(e) => setTextTitle(e.target.value)}
              placeholder="Title (optional — generated automatically if left blank)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <textarea
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="Paste text to index..."
              rows={8}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <span
              className={cn(
                "self-end text-sm text-muted-foreground",
                textValue.trim().length > MAX_TEXT_LENGTH && "text-destructive",
              )}
            >
              {textValue.trim().length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}
            </span>
          </div>
        )}

        <DialogFooter>
          <Button disabled={!canSubmit || isUploading} onClick={handleSubmit}>
            {isUploading ? "Adding..." : "Add & index"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
