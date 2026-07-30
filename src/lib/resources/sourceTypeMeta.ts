import { GlobeIcon, NotepadTextIcon } from "lucide-react";
import type { ComponentType } from "react";
import { PdfBadgeIcon } from "@/components/icons/PdfBadgeIcon";
import type { ResourceSourceType } from "@/types/resource";

export const SOURCE_TYPE_META: Record<
  ResourceSourceType,
  { icon: ComponentType<{ className?: string }>; colorClass: string; label: string }
> = {
  pdf: { icon: PdfBadgeIcon, colorClass: "text-source-pdf", label: "PDF" },
  url: { icon: GlobeIcon, colorClass: "text-source-url", label: "Web link" },
  text: { icon: NotepadTextIcon, colorClass: "text-source-text", label: "Text" },
};
