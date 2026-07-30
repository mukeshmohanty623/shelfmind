import OpenAI from "openai";
import { env } from "@/lib/env";

const TITLE_MODEL = "gpt-4o-mini";
const TITLE_INPUT_CHARS = 2000;

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.openaiApiKey });
  }
  return client;
}

export async function generateTitle(text: string): Promise<string | undefined> {
  const openai = getClient();
  const response = await openai.chat.completions.create({
    model: TITLE_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Respond with only a concise 3-8 word title for the given text. No quotes, no punctuation at the end, no preamble.",
      },
      { role: "user", content: text.slice(0, TITLE_INPUT_CHARS) },
    ],
    max_tokens: 20,
  });

  return response.choices[0]?.message.content?.trim() || undefined;
}
