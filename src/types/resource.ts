export type ResourceStatus = "queued" | "active" | "completed" | "failed";
export type ResourceSourceType = "pdf" | "url" | "text";

export interface Resource {
  id: string;
  filename: string;
  jobId: string;
  createdAt: string;
  sourceType: ResourceSourceType;
  sourceUrl?: string;
  faviconUrl?: string;
}

export interface IndexPdfJobData {
  type: "pdf";
  resourceId: string;
  filename: string;
  fileBase64: string;
}

export interface IndexUrlJobData {
  type: "url";
  resourceId: string;
  url: string;
  html: string;
}

export interface IndexTextJobData {
  type: "text";
  resourceId: string;
  filename: string;
  text: string;
}

export type IndexResourceJobData = IndexPdfJobData | IndexUrlJobData | IndexTextJobData;

export interface IndexResourceJobResult {
  chunkCount: number;
  title?: string;
}

export interface ResourceStatusResponse {
  status: ResourceStatus;
  progress: number;
  chunkCount?: number;
  error?: string;
}
