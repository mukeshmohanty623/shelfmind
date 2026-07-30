import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { listResources, addResource } from "@/lib/resources/store";
import { getIndexQueue } from "@/lib/queue/indexQueue";
import { fetchHtml } from "@/lib/web/fetchHtml";
import { extractReadableText } from "@/lib/web/extractReadableText";
import { generateTitle } from "@/lib/llm/generateTitle";

const MAX_TEXT_LENGTH = 100_000;

export async function GET() {
  const resources = await listResources();
  return NextResponse.json({ resources });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");
  const url = formData.get("url");
  const text = formData.get("text");

  if (typeof url === "string" && url.trim()) {
    return handleUrlResource(url.trim());
  }

  if (typeof text === "string" && text.trim()) {
    const title = formData.get("title");
    return handleTextResource(text, typeof title === "string" ? title.trim() : "");
  }

  if (file instanceof File) {
    return handlePdfResource(file);
  }

  return NextResponse.json({ error: "Provide a PDF file, a URL, or pasted text" }, { status: 400 });
}

async function handlePdfResource(file: File) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
  }

  const resourceId = uuidv4();
  const arrayBuffer = await file.arrayBuffer();
  const fileBase64 = Buffer.from(arrayBuffer).toString("base64");

  const queue = getIndexQueue();
  const job = await queue.add("index-pdf", {
    type: "pdf",
    resourceId,
    filename: file.name,
    fileBase64,
  });

  if (!job.id) {
    return NextResponse.json({ error: "Failed to enqueue job" }, { status: 500 });
  }

  await addResource({
    id: resourceId,
    filename: file.name,
    jobId: job.id,
    createdAt: new Date().toISOString(),
    sourceType: "pdf",
  });

  return NextResponse.json({
    id: resourceId,
    jobId: job.id,
    filename: file.name,
    sourceType: "pdf",
  });
}

async function handleUrlResource(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Enter a valid URL" }, { status: 400 });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Only http:// and https:// URLs are supported" }, { status: 400 });
  }

  let html: string;
  try {
    html = await fetchHtml(parsed.toString());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch that URL";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { title, faviconUrl } = extractReadableText(html, parsed.toString());
  const displayName = title ?? parsed.toString();

  const resourceId = uuidv4();
  const queue = getIndexQueue();
  const job = await queue.add("index-url", {
    type: "url",
    resourceId,
    url: parsed.toString(),
    html,
  });

  if (!job.id) {
    return NextResponse.json({ error: "Failed to enqueue job" }, { status: 500 });
  }

  await addResource({
    id: resourceId,
    filename: displayName,
    jobId: job.id,
    createdAt: new Date().toISOString(),
    sourceType: "url",
    sourceUrl: parsed.toString(),
    faviconUrl,
  });

  return NextResponse.json({
    id: resourceId,
    jobId: job.id,
    filename: displayName,
    sourceType: "url",
    sourceUrl: parsed.toString(),
    faviconUrl,
  });
}

async function handleTextResource(rawText: string, providedTitle: string) {
  const text = rawText.trim();

  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `Text is too long (max ${MAX_TEXT_LENGTH.toLocaleString()} characters)` },
      { status: 400 },
    );
  }

  let title = providedTitle;
  if (!title) {
    try {
      title = (await generateTitle(text)) ?? "";
    } catch (err) {
      console.error("[resources] title generation failed:", err);
    }
  }
  if (!title) {
    title = text.split("\n")[0].slice(0, 60).trim() || "Untitled note";
  }

  const resourceId = uuidv4();
  const queue = getIndexQueue();
  const job = await queue.add("index-text", {
    type: "text",
    resourceId,
    filename: title,
    text,
  });

  if (!job.id) {
    return NextResponse.json({ error: "Failed to enqueue job" }, { status: 500 });
  }

  await addResource({
    id: resourceId,
    filename: title,
    jobId: job.id,
    createdAt: new Date().toISOString(),
    sourceType: "text",
  });

  return NextResponse.json({
    id: resourceId,
    jobId: job.id,
    filename: title,
    sourceType: "text",
  });
}
