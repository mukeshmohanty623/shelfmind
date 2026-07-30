import { isPublicHostname } from "@/lib/web/ipGuard";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_REDIRECTS = 5;

async function assertSafeUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }
  if (!(await isPublicHostname(url.hostname))) {
    throw new Error(`Refusing to fetch a private/internal address: ${url.hostname}`);
  }
}

async function readBodyWithCap(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > MAX_BYTES) {
        await reader.cancel();
        throw new Error(`Page exceeded the ${MAX_BYTES}-byte limit`);
      }
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8");
}

/** Fetches a URL's raw HTML with an SSRF guard, timeout, size cap, and content-type check. */
export async function fetchHtml(rawUrl: string): Promise<string> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertSafeUrl(current);

      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "noteboolm/1.0 (+resource-indexer)" },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect response missing Location header (${response.status})`);
        }
        current = new URL(location, current);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch ${current.toString()}: HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new Error(`Unsupported content-type "${contentType}" at ${current.toString()}`);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_BYTES) {
        throw new Error(`Page too large (${contentLength} bytes) at ${current.toString()}`);
      }

      return await readBodyWithCap(response);
    }

    throw new Error(`Too many redirects fetching ${rawUrl}`);
  } finally {
    clearTimeout(timeout);
  }
}
