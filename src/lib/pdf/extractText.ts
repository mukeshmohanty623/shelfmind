import { PDFParse } from "pdf-parse";

export interface ExtractedPage {
  num: number;
  text: string;
}

export interface ExtractedText {
  text: string;
  pages: ExtractedPage[];
}

export async function extractText(buffer: Buffer): Promise<ExtractedText> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return {
      text: result.text,
      pages: result.pages.map((page) => ({ num: page.num, text: page.text })),
    };
  } finally {
    await parser.destroy();
  }
}
