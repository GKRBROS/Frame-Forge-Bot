// Server-only OpenRouter client.
// Used for chat completions. We use Postgres FTS for retrieval (no embeddings needed).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOptions = {
  model: string;
  fallbackModel?: string | null;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type ChatResult = {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
};

async function callOnce(model: string, opts: ChatOptions): Promise<ChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://knowledgescope.ai",
      "X-Title": "KnowledgeScope AI",
    },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1024,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  return {
    content,
    model: data.model ?? model,
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  };
}

export async function chatComplete(opts: ChatOptions): Promise<ChatResult> {
  try {
    return await callOnce(opts.model, opts);
  } catch (err) {
    if (opts.fallbackModel && opts.fallbackModel !== opts.model) {
      console.warn(`[openrouter] primary failed, falling back to ${opts.fallbackModel}:`, err);
      return await callOnce(opts.fallbackModel, opts);
    }
    throw err;
  }
}
