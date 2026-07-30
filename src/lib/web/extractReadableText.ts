import * as cheerio from "cheerio";

export interface ExtractedPage {
  title?: string;
  text: string;
  faviconUrl?: string;
}

const REMOVE_SELECTORS = "script, style, noscript, nav, header, footer, svg, iframe, form";
const FAVICON_SELECTORS = [
  'link[rel="icon"]',
  'link[rel="shortcut icon"]',
  'link[rel="apple-touch-icon"]',
];

function resolveFaviconUrl($: cheerio.CheerioAPI, pageUrl: string): string | undefined {
  for (const selector of FAVICON_SELECTORS) {
    const href = $(selector).first().attr("href");
    if (href) {
      try {
        return new URL(href, pageUrl).toString();
      } catch {
        continue;
      }
    }
  }
  try {
    return new URL("/favicon.ico", pageUrl).toString();
  } catch {
    return undefined;
  }
}

export function extractReadableText(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  const faviconUrl = resolveFaviconUrl($, pageUrl);
  $(REMOVE_SELECTORS).remove();

  const title = $("title").first().text().trim() || undefined;
  const text = $("body").text().replace(/\s+/g, " ").trim();

  return { title, text, faviconUrl };
}
