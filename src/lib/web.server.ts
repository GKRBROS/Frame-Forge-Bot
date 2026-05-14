// Web fetching, scraping, and search helpers (server-only).

function stripHtml(html: string): string {
  // Try to grab the title for context
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return title ? `${title}\n\n${body}` : body;
}

export type ScrapedPage = { url: string; title: string; text: string };

export async function scrapeUrl(url: string): Promise<ScrapedPage> {
  const u = new URL(url); // throws on invalid
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http/https URLs are supported");
  const res = await fetch(u.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; KnowledgeScopeBot/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Failed to fetch ${u.toString()}: ${res.status}`);
  const html = await res.text();
  const text = stripHtml(html);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : u.hostname;
  return { url: u.toString(), title, text };
}

export type WebSearchResult = { title: string; url: string; snippet: string };

// DuckDuckGo HTML endpoint — no API key required.
export async function webSearch(query: string, limit = 5): Promise<WebSearchResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; KnowledgeScopeBot/1.0)",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results: WebSearchResult[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < limit) {
    let href = m[1];
    // DuckDuckGo wraps real URL in /l/?uddg=...
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      const real = parsed.searchParams.get("uddg");
      if (real) href = decodeURIComponent(real);
    } catch {}
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    const snippet = m[3].replace(/<[^>]+>/g, "").trim();
    if (href.startsWith("http")) results.push({ title, url: href, snippet });
  }
  return results;
}
