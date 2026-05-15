import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { chunkText, approxTokens } from "./chunker.server";
import { extractTextFromBlob } from "./extract.server";
import { chatComplete, type ChatMessage } from "./openrouter.server";
import { scrapeUrl, webSearch } from "./web.server";

function levenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) dp[i][0] = i;
  for (let j = 0; j <= bl; j++) dp[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[al][bl];
}

// ============ QUERY EXPANSION FOR EDUCATIONAL QUERIES ============
// Expands educational queries with synonyms and related concepts
function expandEducationalQuery(query: string): string[] {
  const expanded = new Set([query]);
  const lower = query.toLowerCase();

  // Educational concept mappings
  const expansions: Record<string, string[]> = {
    'string': ['strings', 'text', 'character', 'str'],
    'list': ['lists', 'array', 'sequence', 'collection'],
    'tuple': ['tuples', 'immutable', 'pairs'],
    'dictionary': ['dict', 'map', 'hashmap', 'key-value'],
    'set': ['sets', 'unique', 'collection'],
    'data structure': ['structures', 'data type', 'collection', 'container'],
    'loop': ['loops', 'iteration', 'iterate', 'for', 'while'],
    'function': ['functions', 'method', 'def', 'procedure'],
    'class': ['classes', 'object', 'oop', 'inheritance'],
    'variable': ['variables', 'assignment', 'scope'],
    'operator': ['operators', 'arithmetic', 'logical', 'comparison'],
    'conditional': ['conditions', 'if', 'else', 'branch'],
    'python': ['py', 'python3', 'programming'],
    'java': ['javascript', 'jvm', 'spring'],
    'algorithm': ['algorithms', 'sorting', 'searching', 'complexity'],
    'database': ['databases', 'sql', 'query', 'table'],
    'api': ['apis', 'endpoint', 'rest', 'http'],
    'authentication': ['auth', 'login', 'password', 'session', 'token'],
    'encapsulation': ['encryption', 'security', 'private', 'protect'],
  };

  // Apply expansions
  for (const [key, synonyms] of Object.entries(expansions)) {
    if (lower.includes(key)) {
      for (const syn of synonyms) {
        const expanded_query = query.replace(new RegExp(key, 'gi'), syn);
        expanded.add(expanded_query);
      }
    }
  }

  // Remove common stop words and re-add for broader matching
  const words = query.split(/\s+/);
  for (const word of words) {
    if (word.length > 2) {
      expanded.add(word);  // Individual word search
    }
  }

  return Array.from(expanded).slice(0, 8);  // Limit to 8 expansions
}

function extractKeywords(query: string): string[] {
  return query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !['the', 'and', 'for', 'you', 'are', 'how', 'why', 'what', 'when', 'where', 'can', 'how', 'does', 'have', 'will', 'with', 'from', 'than', 'this', 'that'].includes(t))
    .slice(0, 10);
}

// ============ DOCUMENTS ============

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const ingestText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      title: z.string().trim().min(1).max(200),
      content: z.string().trim().min(10).max(2_000_000),
      collection: z.string().trim().max(80).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .insert({
        user_id: userId,
        title: data.title,
        source_type: "text",
        mime_type: "text/plain",
        byte_size: data.content.length,
        status: "processing",
        collection: data.collection ?? "default",
      })
      .select()
      .single();
    if (docErr || !doc) throw new Error(docErr?.message ?? "Failed to create document");

    try {
      const chunks = chunkText(data.content);
      if (chunks.length === 0) throw new Error("No content to index");
      const rows = chunks.map((content, i) => ({
        document_id: doc.id,
        user_id: userId,
        chunk_index: i,
        content,
        tokens: approxTokens(content),
      }));
      const { error: chErr } = await supabase.from("chunks").insert(rows);
      if (chErr) throw new Error(chErr.message);
      await supabase
        .from("documents")
        .update({ status: "ready", chunk_count: chunks.length })
        .eq("id", doc.id);
      return { documentId: doc.id, chunkCount: chunks.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Indexing failed";
      await supabase.from("documents").update({ status: "failed", error_message: msg }).eq("id", doc.id);
      throw err;
    }
  });

export const ingestUploadedFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      filePath: z.string().min(1),
      title: z.string().trim().min(1).max(200),
      mimeType: z.string().min(1),
      collection: z.string().trim().max(80).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    // Verify path belongs to user
    if (!data.filePath.startsWith(`${userId}/`)) {
      throw new Error("Unauthorized file path");
    }
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .insert({
        user_id: userId,
        title: data.title,
        source_type: "upload",
        file_path: data.filePath,
        mime_type: data.mimeType,
        status: "processing",
        collection: data.collection ?? "default",
      })
      .select()
      .single();
    if (docErr || !doc) throw new Error(docErr?.message ?? "Failed to create document");

    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from("knowledge-documents")
        .download(data.filePath);
      if (dlErr || !blob) throw new Error(dlErr?.message ?? "Failed to download file");

      const text = await extractTextFromBlob(blob, data.mimeType, data.title);
      const chunks = chunkText(text);
      if (chunks.length === 0) throw new Error("No extractable text in file");

      const rows = chunks.map((content, i) => ({
        document_id: doc.id,
        user_id: userId,
        chunk_index: i,
        content,
        tokens: approxTokens(content),
      }));
      const { error: chErr } = await supabase.from("chunks").insert(rows);
      if (chErr) throw new Error(chErr.message);

      await supabase
        .from("documents")
        .update({ status: "ready", chunk_count: chunks.length, byte_size: blob.size })
        .eq("id", doc.id);
      return { documentId: doc.id, chunkCount: chunks.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Indexing failed";
      await supabase.from("documents").update({ status: "failed", error_message: msg }).eq("id", doc.id);
      throw err;
    }
  });

export const ingestUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      url: z.string().url(),
      collection: z.string().trim().max(80).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const page = await scrapeUrl(data.url);
    if (!page.text || page.text.length < 40) throw new Error("Page had no extractable text");

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .insert({
        user_id: userId,
        title: page.title.slice(0, 200),
        source_type: "url",
        source_url: page.url,
        mime_type: "text/html",
        byte_size: page.text.length,
        status: "processing",
        collection: data.collection ?? "default",
      })
      .select()
      .single();
    if (docErr || !doc) throw new Error(docErr?.message ?? "Failed to create document");

    try {
      const chunks = chunkText(page.text);
      const rows = chunks.map((content, i) => ({
        document_id: doc.id,
        user_id: userId,
        chunk_index: i,
        content,
        tokens: approxTokens(content),
      }));
      const { error: chErr } = await supabase.from("chunks").insert(rows);
      if (chErr) throw new Error(chErr.message);
      await supabase.from("documents").update({ status: "ready", chunk_count: chunks.length }).eq("id", doc.id);
      return { documentId: doc.id, chunkCount: chunks.length, url: page.url, title: page.title };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Indexing failed";
      await supabase.from("documents").update({ status: "failed", error_message: msg }).eq("id", doc.id);
      throw err;
    }
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    // Look up file_path so we can also remove the storage object
    const { data: doc } = await supabase.from("documents").select("file_path").eq("id", data.id).maybeSingle();
    const { error } = await supabase.from("documents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (doc?.file_path) {
      await supabase.storage.from("knowledge-documents").remove([doc.file_path]);
    }
    return { ok: true };
  });

export const toggleDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase.from("documents").update({ enabled: data.enabled }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ AI SETTINGS ============

export const getAiSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase.from("ai_settings").select("*").eq("id", 1).single();
    if (error) throw new Error(error.message);
    return data;
  });

export const updateAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      active_model: z.string().min(1).optional(),
      fallback_model: z.string().nullable().optional(),
      temperature: z.number().min(0).max(2).optional(),
      max_tokens: z.number().int().min(64).max(8192).optional(),
      confidence_threshold: z.number().min(0).max(1).optional(),
      strict_knowledge: z.boolean().optional(),
      allow_internet: z.boolean().optional(),
      allow_web_scraping: z.boolean().optional(),
      enable_ocr: z.boolean().optional(),
      hallucination_prevention: z.boolean().optional(),
      out_of_scope_rejection: z.boolean().optional(),
      image_extraction: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Admin only");
    const { error } = await supabase.from("ai_settings").update(data).eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ CONVERSATIONS / MESSAGES ============

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversationId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: convo } = await supabase
      .from("conversations")
      .select("title")
      .eq("id", data.conversationId)
      .maybeSingle();

    await supabase.from("query_logs").insert({
      user_id: context.userId,
      conversation_id: data.conversationId,
      question: convo?.title ? `Opened conversation: ${convo.title}` : "Opened conversation",
      event_type: "chat_open",
      event_label: convo?.title ?? "Conversation opened",
      confidence: 1,
      rejected: false,
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
    });

    const { data: msgs, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return msgs ?? [];
  });

export const createConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ title: z.string().trim().max(120).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: c, error } = await supabase
      .from("conversations")
      .insert({ user_id: userId, title: data.title ?? "New chat" })
      .select()
      .single();
    if (error || !c) throw new Error(error?.message ?? "Failed");
    return c;
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase.from("conversations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ ASK QUESTION (RAG) ============

const SYSTEM_PROMPT = `You are a restricted educational AI assistant.

ABSOLUTE RULES:
1. Answer using ONLY the provided CONTEXT excerpts from the uploaded knowledge base.
2. Do NOT invent facts or use outside knowledge beyond the provided excerpts.
3. If the provided CONTEXT is semantically related to the question, provide a helpful educational explanation.
4. Only reply with: "Sorry, this is outside my knowledge scope." when there is absolutely no relevant educational context.
5. Cite sources inline using [n] where n is the excerpt number. Do not fabricate citations.
6. Structure answers with the sections: Definition, Explanation, Example, Key Points, Optional Notes when applicable.
7. Adapt explanations to the requested learning level: beginner, intermediate, advanced.
8. Keep answers factual, clear, and educational. Use markdown for structure.`;

const SYSTEM_PROMPT_WITH_WEB = `You are a restricted educational AI assistant.

RULES:
1. Answer using the provided CONTEXT excerpts from the uploaded knowledge base and optionally labelled web results.
2. Prefer knowledge-base excerpts over web results when both are present.
3. If neither the knowledge base nor web results contain the answer, reply: "Sorry, I couldn't find an answer."
4. Structure answers with: Definition, Explanation, Example, Key Points, Optional Notes.
5. Adapt explanations to the requested learning level: beginner, intermediate, advanced.
6. Cite sources inline using [n] for KB excerpts and [Wn] for web results. Do not fabricate citations.`;

async function fetchWebContext(query: string, limit = 4): Promise<{ contextItems: string[]; citations: Array<{ n: number; document_id: string; document_title: string; excerpt: string; score: number }> }> {
  try {
    const results = await webSearch(query, limit);
    const fetched = await Promise.all(
      results.slice(0, limit).map(async (r) => {
        try {
          const page = await scrapeUrl(r.url);
          return { ...r, text: page.text.slice(0, 2000) };
        } catch {
          return { ...r, text: r.snippet };
        }
      }),
    );
    const contextItems = fetched.map((r, i) => `[W${i + 1}] (web: ${r.url})\n${r.text}`);
    const citations = fetched.map((r, i) => ({
      n: i + 1,
      document_id: "web",
      document_title: `${r.title} (web)`,
      excerpt: (r.text || r.snippet).slice(0, 280),
      score: 0,
    }));
    return { contextItems, citations };
  } catch {
    return { contextItems: [], citations: [] };
  }
}

function normalizeQueryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 8);
}

function isEducationalQuery(query: string): boolean {
  return /python|java|data structure|algorithm|loop|function|class|array|list|tuple|string|database|api|html|css|javascript/i.test(query);
}

export const askQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      conversationId: z.string().uuid(),
      question: z.string().trim().min(1).max(2000),
      level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const start = Date.now();

    // Save user message
    await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "user",
      content: data.question,
    });

    // Load settings
    const { data: settings } = await supabase.from("ai_settings").select("*").eq("id", 1).single();
    const configuredThreshold = Number(settings?.confidence_threshold ?? 0.15);
    const model = settings?.active_model ?? "deepseek/deepseek-chat-v3.1";
    const fallback = settings?.fallback_model ?? null;
    const strict = settings?.strict_knowledge ?? true;
    const rejectOutOfScope = settings?.out_of_scope_rejection ?? true;
    const allowInternet = settings?.allow_internet ?? false;
    const TOP_K = Math.max(10, Number(settings?.top_k ?? 12));

    // Hybrid retrieval pipeline (semantic RPC + BM25-like token search + fuzzy title matching)
    async function hybridRetrieve(limit = TOP_K) {
      const combined: Array<any> = [];
      // 1) Primary semantic/vector search via RPC
      const { data: hits, error: searchErr } = await supabaseAdmin.rpc("search_chunks", {
        _user_id: userId,
        _query: data.question,
        _limit: limit,
      });
      if (searchErr) console.debug("search_chunks RPC error:", searchErr.message);
      const semantic = (hits ?? []) as Array<any>;
      for (const h of semantic) {
        combined.push({
          chunk_id: h.chunk_id ?? h.id ?? `${h.document_id}-${h.chunk_index ?? 0}`,
          document_id: h.document_id,
          document_title: h.document_title,
          content: h.content,
          score: typeof h.score === "number" ? h.score : 0.8,
          source: "semantic",
        });
      }

      // 2) Token / keyword fallback (BM25-ish): break query into tokens and ilike-search chunks
      const qTokens = data.question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);
      const tokenMatches: Record<string, any> = {};
      for (const t of qTokens) {
        const { data: chunks } = await supabaseAdmin.from("chunks").select("id,content,document_id,document_title,chunk_index").ilike("content", `%${t}%`).eq("user_id", userId).limit(6);
        if (!chunks) continue;
        for (const c of chunks as any[]) {
          const key = `${c.document_id}-${c.chunk_index ?? 0}-${(c.id ?? "").slice(0,8)}`;
          if (!tokenMatches[key]) tokenMatches[key] = { ...c, hits: 0 };
          tokenMatches[key].hits += 1;
        }
      }
      for (const k of Object.keys(tokenMatches)) {
        const c = tokenMatches[k];
        combined.push({
          chunk_id: c.id ?? k,
          document_id: c.document_id,
          document_title: c.document_title,
          content: c.content,
          score: 0.4 + Math.min(0.5, (c.hits / Math.max(1, qTokens.length)) * 0.6),
          source: "token",
        });
      }

      // 3) Fuzzy title match for short queries
      if (data.question.trim().length > 0 && data.question.trim().length <= 60) {
        const { data: docs } = await supabaseAdmin.from("documents").select("id,title").eq("user_id", userId);
        if (docs && docs.length > 0) {
          const q = data.question.trim().toLowerCase();
          let best: any = null;
          for (const d of docs as any[]) {
            const title = (d.title ?? "").toLowerCase();
            const dist = levenshtein(q, title);
            if (!best || dist < best.dist) best = { id: d.id, title: d.title, dist };
          }
          if (best) {
            const maxAllowed = Math.max(2, Math.floor((best.title.length ?? 0) * 0.35));
            if (best.dist <= maxAllowed) {
              const { data: chunks } = await supabaseAdmin.from("chunks").select("id,content,document_id,document_title,chunk_index").eq("document_id", best.id).limit(8);
              if (chunks) {
                for (const c of chunks as any[]) combined.push({ chunk_id: c.id ?? `${best.id}-${c.chunk_index}`, document_id: c.document_id, document_title: c.document_title ?? best.title, content: c.content, score: 0.85, source: "title-fuzzy" });
              }
            }
          }
        }
      }

      // Deduplicate by document + leading content
      const dedup = new Map<string, any>();
      for (const c of combined) {
        const key = `${c.document_id}-${(c.content ?? "").slice(0, 120)}`;
        if (!dedup.has(key)) dedup.set(key, c);
        else {
          // keep the higher score
          const ex = dedup.get(key);
          if ((c.score ?? 0) > (ex.score ?? 0)) dedup.set(key, c);
        }
      }
      let merged = Array.from(dedup.values());

      // Rerank: normalize scores and boost by token overlap
      const scores = merged.map((m) => m.score ?? 0);
      const maxS = Math.max(...scores, 0.0001);
      const minS = Math.min(...scores);
      const qLower = data.question.toLowerCase();
      merged = merged.map((m) => {
        const tokenOverlap = qTokens.reduce((s, t) => s + ((m.content || "").toLowerCase().includes(t) ? 1 : 0), 0);
        const overlapFactor = tokenOverlap / Math.max(1, qTokens.length);
        // normalized
        const norm = (m.score - minS) / (maxS - minS + 1e-9);
        const final = Math.min(1, norm * 0.7 + overlapFactor * 0.4 + (m.source === "title-fuzzy" ? 0.2 : 0));
        return { ...m, finalScore: final };
      });

      // Sort and take top limit
      merged.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
      merged = merged.slice(0, limit);

      // 4) Context expansion: fetch neighboring chunks within same documents (±1)
      const expanded: Array<any> = [];
      for (const m of merged) {
        expanded.push(m);
        try {
          const idx = typeof m.chunk_index === 'number' ? m.chunk_index : null;
          if (idx == null) {
            // attempt to read chunk_index from DB by matching content/document
            const { data: found } = await supabaseAdmin.from('chunks').select('chunk_index').eq('document_id', m.document_id).ilike('content', `${(m.content ?? '').slice(0, 30)}%`).limit(1).maybeSingle();
            if (found?.chunk_index != null) {
              const nIdx = found.chunk_index;
              const { data: neigh } = await supabaseAdmin.from('chunks').select('id,content,document_id,document_title,chunk_index').eq('document_id', m.document_id).in('chunk_index', [nIdx-1, nIdx+1]).limit(4);
              if (neigh) for (const n of neigh as any[]) expanded.push({ ...n, finalScore: (m.finalScore ?? 0) * 0.75, source: 'neighbor' });
            }
          } else {
            const { data: neigh } = await supabaseAdmin.from('chunks').select('id,content,document_id,document_title,chunk_index').eq('document_id', m.document_id).in('chunk_index', [idx-1, idx+1]).limit(4);
            if (neigh) for (const n of neigh as any[]) expanded.push({ ...n, finalScore: (m.finalScore ?? 0) * 0.75, source: 'neighbor' });
          }
        } catch (e) {
          // ignore neighbor failures
        }
      }

      // final dedupe and sort
      const finalMap = new Map<string, any>();
      for (const e of expanded) {
        const key = `${e.document_id}-${(e.content ?? '').slice(0,120)}`;
        if (!finalMap.has(key) || (e.finalScore ?? 0) > (finalMap.get(key).finalScore ?? 0)) finalMap.set(key, e);
      }
      const finalArr = Array.from(finalMap.values()).sort((a,b)=> (b.finalScore??0)-(a.finalScore??0)).slice(0, limit);
      return finalArr;
    }

    const results = await hybridRetrieve();

    // Confidence and low-confidence detection (do not auto-reject purely on threshold)
    const rawScores = results.map((r) => r.finalScore ?? r.score ?? 0);
    const topScore = rawScores.length ? Math.max(...rawScores) : 0;
    const confidence = Math.min(1, topScore);
    const dynamicThreshold = Math.max(0.15, configuredThreshold); // keep configured but ensure a floor
    const lowConfidence = results.length === 0 || confidence < dynamicThreshold;

    // Optional: pull live web context when KB is weak and internet access is enabled
    let webCitations: Array<{ n: number; document_id: string; document_title: string; excerpt: string; score: number }> = [];
    let webContextItems: string[] = [];
    if (allowInternet && lowConfidence) {
      const w = await fetchWebContext(data.question, 4);
      webCitations = w.citations;
      webContextItems = w.contextItems;
    }

    // Strict mode and no KB fallback: reject only when absolutely no KB hits
    if (strict && rejectOutOfScope && results.length === 0) {
      const reply = "Sorry, this is outside my knowledge scope.";
      const { data: assistantMsg } = await supabase.from("messages").insert({
        conversation_id: data.conversationId,
        user_id: userId,
        role: "assistant",
        content: reply,
        confidence,
        rejected: true,
        latency_ms: Date.now() - start,
        model,
      }).select().single();
      await supabase.from("query_logs").insert({
        user_id: userId,
        conversation_id: data.conversationId,
        question: data.question,
        event_type: "question",
        event_label: data.level ? `Level: ${data.level}` : "Question",
        confidence,
        rejected: true,
        model,
        latency_ms: Date.now() - start,
      });
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", data.conversationId);
      return { message: assistantMsg, citations: [] };
    }

    // Prepare KB block and include debug log of retrieval
    const kbBlock = results
      .map((r, i) => `[${i + 1}] (source: ${r.document_title})\n${r.content}`)
      .join("\n\n---\n\n");
    console.debug("RAG retrieval debug:", {
      question: data.question,
      results: results.map((r, i) => ({ rank: i+1, document_id: r.document_id, title: r.document_title, score: r.finalScore ?? r.score, source: r.source })),
      lowConfidence,
    });
    const contextBlock = [kbBlock, ...webContextItems].filter(Boolean).join("\n\n---\n\n") || "(no excerpts available)";
    const useWeb = webContextItems.length > 0;

    const levelInstr = data.level ? `Answer for a ${data.level} audience. Use clear, ${data.level === 'beginner' ? 'simple' : data.level === 'intermediate' ? 'concise' : 'detailed'} sentences and explain terms as needed.` : '';
    const formatInstr = `When composing the answer, structure it into sections when applicable: Definition, Explanation, Example, Key Points, Optional Notes. Use the citations [n] inline where you used KB excerpts.`;
    const messages: ChatMessage[] = [
      { role: "system", content: useWeb ? SYSTEM_PROMPT_WITH_WEB : SYSTEM_PROMPT },
      ...(levelInstr ? [{ role: "system", content: levelInstr }] : []),
      { role: "system", content: formatInstr },
      {
        role: "user",
        content: `CONTEXT EXCERPTS:\n\n${contextBlock}\n\nQUESTION: ${data.question}`,
      },
    ];

    let aiResult;
    try {
      aiResult = await chatComplete({
        model,
        fallbackModel: fallback,
        messages,
        temperature: Number(settings?.temperature ?? 0.2),
        maxTokens: settings?.max_tokens ?? 1024,
      });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : "AI provider failed";
      const { data: assistantMsg } = await supabase.from("messages").insert({
        conversation_id: data.conversationId,
        user_id: userId,
        role: "assistant",
        content: `⚠️ ${msg}`,
        rejected: true,
        latency_ms: Date.now() - start,
        model,
      }).select().single();
      return { message: assistantMsg, citations: [] };
    }

    // Detect "outside scope" answer to flag rejection in analytics
    const wasRejected = /outside my knowledge scope/i.test(aiResult.content);

    const kbCitations = results.map((r, i) => ({
      n: i + 1,
      document_id: r.document_id,
      document_title: r.document_title,
      excerpt: r.content.slice(0, 280),
      score: r.score,
    }));
    const webCitationsOffset = (webCitations ?? []).map((c) => ({ ...c, n: kbCitations.length + c.n }));
    const citations = [...kbCitations, ...webCitationsOffset];

    const latency = Date.now() - start;
    const { data: assistantMsg, error: insErr } = await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "assistant",
      content: aiResult.content,
      citations,
      confidence,
      rejected: wasRejected,
      model: aiResult.model,
      tokens_in: aiResult.tokensIn,
      tokens_out: aiResult.tokensOut,
      latency_ms: latency,
    }).select().single();
    if (insErr) throw new Error(insErr.message);

    await supabase.from("query_logs").insert({
      user_id: userId,
      conversation_id: data.conversationId,
      question: data.question,
      event_type: "question",
      event_label: data.level ? `Level: ${data.level}` : "Question",
      confidence,
      rejected: wasRejected,
      model: aiResult.model,
      tokens_in: aiResult.tokensIn,
      tokens_out: aiResult.tokensOut,
      latency_ms: latency,
    });
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", data.conversationId);

    return { message: assistantMsg, citations };
  });

// ============ ROLE / ADMIN ============

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = (data ?? []).map((r) => r.role);
    return { isAdmin: roles.includes("admin"), roles };
  });

// Auto-promote the very first signed-in user to admin (bootstrap).
export const ensureAdminBootstrap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) === 0) {
      await supabaseAdmin.from("user_roles").upsert(
        { user_id: userId, role: "admin" },
        { onConflict: "user_id,role" },
      );
      return { promoted: true };
    }
    return { promoted: false };
  });

// ============ PUBLIC ASK (no auth) ============
// Anonymous visitors can ask questions; we search across the admin's knowledge base.

async function getAdminUserId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  return data?.user_id ?? null;
}

export const askPublic = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      question: z.string().trim().min(1).max(2000),
      level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
      fileData: z.string().optional(), // base64
      fileName: z.string().optional(),
      fileType: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const start = Date.now();
    const adminId = await getAdminUserId();
    const { data: settings } = await supabaseAdmin.from("ai_settings").select("*").eq("id", 1).single();
    const threshold = Number(settings?.confidence_threshold ?? 0.40); // ← LOWERED to 0.40 for educational
    const model = settings?.active_model ?? "deepseek/deepseek-chat-v3.1";
    const fallback = settings?.fallback_model ?? null;
    const strict = settings?.strict_knowledge ?? true;
    const allowInternet = settings?.allow_internet ?? false;
    const TOP_K = Math.max(15, Number(settings?.top_k ?? 15)); // ← INCREASED to 15

    // Handle uploaded file if present
    let fileContext = "";
    if (data.fileData) {
      try {
        const bin = Buffer.from(data.fileData, "base64");
        const blob = new Blob([bin], { type: data.fileType });
        fileContext = await extractTextFromBlob(blob, data.fileType ?? "application/octet-stream", data.fileName);
        console.debug("[askPublic] extracted text from file:", { name: data.fileName, len: fileContext.length });
      } catch (err) {
        console.error("[askPublic] file extraction failed:", err);
      }
    }

    if (!adminId && !fileContext) {
      return {
        content: "The knowledge base is not yet set up. Please ask the administrator to upload documents.",
        citations: [], confidence: 0, rejected: true, latencyMs: Date.now() - start, model,
      };
    }

    // Aggressive multi-strategy retrieval for educational queries
    async function hybridRetrieveAdmin(limit = TOP_K) {
      const combined: Array<any> = [];
      const queryTokens = normalizeQueryTokens(data.question);
      const queryExpansions = expandEducationalQuery(data.question).slice(0, isEducationalQuery(data.question) ? 2 : 1);

      const [semanticResults, keywordResults] = await Promise.all([
        Promise.all(
          queryExpansions.map(async (expandedQuery) => {
            const { data: hits, error: searchErr } = await supabaseAdmin.rpc("search_chunks", {
              _user_id: adminId,
              _query: expandedQuery,
              _limit: Math.min(limit, 8),
            });
            if (searchErr) console.debug(`[retrieval] RPC error for "${expandedQuery}":`, searchErr.message);
            return Array.isArray(hits) ? hits : [];
          }),
        ),
        queryTokens.length > 0
          ? supabaseAdmin.rpc("search_chunks_keyword", {
              _user_id: adminId,
              _keywords: queryTokens,
              _limit: Math.min(limit, 8),
            })
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      for (const batch of semanticResults) {
        for (const h of batch as any[]) {
          const key = `semantic-${h.document_id}-${(h.content ?? '').slice(0, 60)}`;
          if (!combined.find((c) => c.key === key)) {
            combined.push({
              key,
              chunk_id: h.chunk_id ?? h.id ?? `${h.document_id}-0`,
              document_id: h.document_id,
              document_title: h.document_title,
              content: h.content,
              chunk_index: h.chunk_index,
              score: Math.max(0.3, typeof h.score === 'number' ? h.score : 0.5),
              source: 'semantic-rpc',
            });
          }
        }
      }

      if (keywordResults?.error) {
        console.debug("[retrieval] keyword RPC error:", keywordResults.error.message);
      }
      for (const c of (keywordResults?.data ?? []) as any[]) {
        const key = `token-${c.document_id}-${(c.content ?? '').slice(0, 60)}`;
        if (!combined.find((ch) => ch.key === key)) {
          combined.push({
            key,
            chunk_id: c.id ?? c.chunk_id,
            document_id: c.document_id,
            document_title: c.document_title,
            content: c.content,
            chunk_index: c.chunk_index,
            score: 0.45 + Math.min(0.35, ((c.score ?? 0) / 100) * 0.35),
            source: 'keyword-rpc',
          });
        }
      }

      // Optional title matching only when we still have too few hits.
      if (combined.length < 3 && data.question.trim().length > 0 && data.question.trim().length <= 80) {
        const titleTokens = queryTokens.slice(0, 3);
        const { data: docs } = await supabaseAdmin
          .from('documents')
          .select('id,title')
          .eq('user_id', adminId)
          .ilike('title', `%${titleTokens[0] ?? ''}%`)
          .limit(10);

        if (docs && docs.length > 0) {
          for (const d of docs as any[]) {
            const title = (d.title ?? '').toLowerCase();
            const matchCount = titleTokens.filter((t) => title.includes(t)).length;
            if (!matchCount) continue;
            const { data: chunks } = await supabaseAdmin
              .from('chunks')
              .select('id,content,document_id,document_title,chunk_index')
              .eq('document_id', d.id)
              .order('chunk_index', { ascending: true })
              .limit(4);

            for (const c of (chunks ?? []) as any[]) {
              const key = `title-${c.document_id}-${(c.content ?? '').slice(0, 60)}`;
              if (!combined.find((ch) => ch.key === key)) {
                combined.push({
                  key,
                  chunk_id: c.id,
                  document_id: c.document_id,
                  document_title: c.document_title,
                  content: c.content,
                  chunk_index: c.chunk_index,
                  score: 0.50 + (matchCount / Math.max(1, titleTokens.length)) * 0.2,
                  source: 'title-match',
                });
              }
            }
          }
        }
      }

      // Remove key field and deduplicate
      const dedup = new Map<string, any>();
      for (const item of combined) {
        const contentKey = `${item.document_id}-${(item.content ?? '').slice(0, 100)}`;
        const existing = dedup.get(contentKey);
        if (!existing || (item.score ?? 0) > (existing.score ?? 0)) {
          dedup.set(contentKey, item);
        }
      }

      let merged = Array.from(dedup.values()).map(({ key, ...rest }) => rest);  // Remove key field
      
      // Rerank by score
      merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      merged = merged.slice(0, limit);

      // Context expansion: fetch neighbors only for the strongest few results
      const expanded: Array<any> = [];
      for (const m of merged.slice(0, 3)) {
        expanded.push(m);
        if (m.chunk_index == null) continue;
        try {
          const { data: neighbors } = await supabaseAdmin
            .from('chunks')
            .select('id,content,document_id,document_title,chunk_index')
            .eq('document_id', m.document_id)
            .in('chunk_index', [m.chunk_index - 1, m.chunk_index + 1])
            .limit(2);

          if (neighbors) {
            for (const n of neighbors as any[]) {
              expanded.push({
                ...n,
                score: (m.score ?? 0) * 0.65,
                source: 'neighbor-context',
              });
            }
          }
        } catch (e) {
          // Neighbor expansion failures don't stop retrieval
        }
      }

      // Final dedup and sort
      const finalMap = new Map<string, any>();
      for (const e of expanded) {
        const contentKey = `${e.document_id}-${(e.content ?? '').slice(0, 100)}`;
        if (!finalMap.has(contentKey) || (e.score ?? 0) > (finalMap.get(contentKey).score ?? 0)) {
          finalMap.set(contentKey, e);
        }
      }

      const finalResults = Array.from(finalMap.values())
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, limit);

      console.debug('[retrieval]', {
        question: data.question,
        strategies_used: ['semantic-rpc-expanded', 'keyword-search', 'title-matching', 'neighbor-expansion'],
        results_found: finalResults.length,
        top_scores: finalResults.slice(0, 3).map((r, i) => ({ rank: i+1, score: r.score, source: r.source, title: r.document_title })),
        retrieval_time_ms: Date.now() - start,
      });

      return finalResults;
    }

    const results = await hybridRetrieveAdmin();
    const rawScores = results.map((r) => r.score ?? 0);
    const topScore = rawScores.length ? Math.max(...rawScores) : 0;
    const confidence = Math.min(1, topScore);
    
    // Adaptive threshold - lower for educational queries
    const isEducational = isEducationalQuery(data.question);
    const dynamicThreshold = isEducational ? 0.25 : Math.max(0.40, threshold);
    const lowConfidence = results.length === 0 || confidence < dynamicThreshold;

    // Optional: pull live web context when KB is weak
    let webCitations: Array<{ n: number; document_id: string; document_title: string; excerpt: string; score: number }> = [];
    let webContextItems: string[] = [];
    if (allowInternet && lowConfidence) {
      const w = await fetchWebContext(data.question, 4);
      webCitations = w.citations;
      webContextItems = w.contextItems;
    }

    // ONLY reject if: strict AND absolutely no KB results AND no web context AND no file context
    if (strict && results.length === 0 && webContextItems.length === 0 && !fileContext) {
      console.debug('[rejection]', { question: data.question, reason: 'no-kb-results-no-web-no-file' });
      return {
        content: "Sorry, this is outside my knowledge scope.",
        citations: [], confidence: 0, rejected: true, latencyMs: Date.now() - start, model,
      };
    }

    // If we have ANY results, use them (don't over-filter)
    const kbBlock = results
      .map((r, i) => `[${i + 1}] (${r.source ?? 'unknown'}, confidence: ${(r.score ?? 0).toFixed(2)})\n${r.content}`)
      .join("\n\n---\n\n");
    
    const contextBlock = [
      fileContext ? `[FILE] Content from uploaded file "${data.fileName}":\n${fileContext}` : null,
      kbBlock, 
      ...webContextItems
    ].filter(Boolean).join("\n\n---\n\n") || "(no matched excerpts - attempting general knowledge)";
    const useWeb = webContextItems.length > 0;

    const levelInstr = data.level ? `Answer for a ${data.level} audience. Use ${data.level === 'beginner' ? 'very simple' : data.level === 'intermediate' ? 'clear, concise' : 'detailed and technical'} language and explain all terms.` : '';
    const formatInstr = `Structure your answer with: Definition, Explanation, Examples, Key Points. Use [n] to cite KB excerpts.`;
    
    const messages: ChatMessage[] = [
      { role: "system", content: useWeb ? SYSTEM_PROMPT_WITH_WEB : SYSTEM_PROMPT },
      ...(levelInstr ? [{ role: "system", content: levelInstr }] : []),
      { role: "system", content: formatInstr },
      { role: "user", content: `CONTEXT EXCERPTS:\n\n${contextBlock}\n\nQUESTION: ${data.question}` },
    ];

    let aiResult;
    try {
      aiResult = await chatComplete({
        model, fallbackModel: fallback, messages,
        temperature: Number(settings?.temperature ?? 0.2),
        maxTokens: settings?.max_tokens ?? 1024,
      });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : "AI provider failed";
      return {
        content: `⚠️ ${msg}`,
        citations: [],
        confidence: 0,
        rejected: true,
        latencyMs: Date.now() - start,
        model,
      };
    }

    const wasRejected = /outside my knowledge scope/i.test(aiResult.content) && results.length === 0;
    const kbCitations = results.map((r, i) => ({
      n: i + 1, document_id: r.document_id, document_title: r.document_title,
      excerpt: r.content.slice(0, 280), score: r.score,
    }));
    const webCitationsOffset = (webCitations ?? []).map((c) => ({ ...c, n: kbCitations.length + c.n }));
    const citations = [...kbCitations, ...webCitationsOffset];

    if (fileContext) {
      citations.unshift({
        n: 0,
        document_id: "upload",
        document_title: data.fileName || "Uploaded File",
        excerpt: fileContext.slice(0, 280),
        score: 1,
      });
    }

    return {
      content: aiResult.content, citations, confidence,
      rejected: wasRejected, latencyMs: Date.now() - start, model: aiResult.model,
    };
  });

// ============ ADMIN ACCOUNT BOOTSTRAP (hardcoded credentials) ============
// Ensures the admin account exists with known credentials so the admin can sign in.
export const ensureAdminAccount = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      email: z.string().email(),
      password: z.string().min(6).max(200),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    // Sanitize .env values (strip accidental quotes/whitespace) and compare trimmed inputs
    const rawEnvEmail = process.env.ADMIN_USERID ?? "admin@yourdomain.com";
    const rawEnvPassword = process.env.ADMIN_PASSWORD ?? "";
    const providedEmail = String(data.email ?? "").toLowerCase().trim();
    const providedPassword = String(data.password ?? "");
    if (providedEmail !== ADMIN_EMAIL || (ADMIN_PASSWORD && providedPassword !== ADMIN_PASSWORD)) {
      throw new Error("Only the designated admin credentials (from .env) can be used to provision the admin account.");
    }

    // Check if user exists
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
    const found = existing?.users?.find((u) => u.email?.toLowerCase() === ADMIN_EMAIL);

    let userId: string;
    if (!found) {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: ADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: "Administrator" },
      });
      if (error || !created.user) throw new Error(error?.message ?? "Failed to create admin user");
      userId = created.user.id;
    } else {
      userId = found.id;
      // Make sure password matches what we expect (idempotent reset)
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: ADMIN_PASSWORD,
        email_confirm: true,
      });
    }

    // Ensure profile + admin role
    await supabaseAdmin.from("profiles").upsert(
      { user_id: userId, display_name: "Administrator" },
      { onConflict: "user_id" },
    );
    await supabaseAdmin.from("user_roles").upsert(
      { user_id: userId, role: "admin" },
      { onConflict: "user_id,role" },
    );

    return { ok: true };
  });

// ============ ANALYTICS ============

export const getAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });

    let logsQuery = supabaseAdmin
      .from("query_logs")
      .select("confidence,rejected,model,tokens_in,tokens_out,latency_ms,created_at,question")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (!isAdmin) logsQuery = logsQuery.eq("user_id", userId);
    const { data: logs } = await logsQuery;

    const all = logs ?? [];
    const totalQueries = all.length;
    const rejectedCount = all.filter((l) => l.rejected).length;
    const avgConfidence = totalQueries
      ? all.reduce((s, l) => s + Number(l.confidence ?? 0), 0) / totalQueries
      : 0;
    const avgLatency = totalQueries
      ? all.reduce((s, l) => s + (l.latency_ms ?? 0), 0) / totalQueries
      : 0;
    const totalTokensIn = all.reduce((s, l) => s + (l.tokens_in ?? 0), 0);
    const totalTokensOut = all.reduce((s, l) => s + (l.tokens_out ?? 0), 0);
    const recentLogs = all.map((l) => ({
      event_type: l.event_type ?? "question",
      event_label: l.event_label ?? null,
      question: l.question,
      conversation_id: l.conversation_id,
      confidence: l.confidence,
      rejected: l.rejected,
      latency_ms: l.latency_ms,
      model: l.model,
      created_at: l.created_at,
    }));

    // Per-day aggregates (last 14d)
    const byDay = new Map<string, { day: string; queries: number; rejected: number }>();
    const since = Date.now() - 14 * 24 * 3600 * 1000;
    for (const l of all) {
      const t = new Date(l.created_at).getTime();
      if (t < since) continue;
      const day = new Date(l.created_at).toISOString().slice(0, 10);
      const cur = byDay.get(day) ?? { day, queries: 0, rejected: 0 };
      cur.queries += 1;
      if (l.rejected) cur.rejected += 1;
      byDay.set(day, cur);
    }
    const daily = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));

    // Document stats
    let docsQuery = supabaseAdmin.from("documents").select("status,chunk_count,byte_size,user_id");
    if (!isAdmin) docsQuery = docsQuery.eq("user_id", userId);
    const { data: docs } = await docsQuery;
    const docList = docs ?? [];

    return {
      isAdmin: !!isAdmin,
      totals: {
        queries: totalQueries,
        rejected: rejectedCount,
        avgConfidence,
        avgLatency,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        documents: docList.length,
        chunks: docList.reduce((s, d) => s + (d.chunk_count ?? 0), 0),
        bytes: docList.reduce((s, d) => s + (d.byte_size ?? 0), 0),
      },
      daily,
      recentRejected: all.filter((l) => l.rejected).slice(0, 10).map((l) => ({
        question: l.question,
        confidence: l.confidence,
        created_at: l.created_at,
      })),
      recentLogs,
    };
  });

// ============ ADMIN: USERS ============

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Admin only");

    const { data: profiles } = await supabaseAdmin.from("profiles").select("user_id,display_name,created_at");
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id,role");
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r) => {
      const list = roleMap.get(r.user_id) ?? [];
      list.push(r.role);
      roleMap.set(r.user_id, list);
    });
    return (profiles ?? []).map((p) => ({
      ...p,
      roles: roleMap.get(p.user_id) ?? ["user"],
    }));
  });

export const setUserAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ targetUserId: z.string().uuid(), makeAdmin: z.boolean() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Admin only");
    if (data.makeAdmin) {
      await supabaseAdmin.from("user_roles").upsert(
        { user_id: data.targetUserId, role: "admin" },
        { onConflict: "user_id,role" },
      );
    } else {
      if (data.targetUserId === userId) throw new Error("Cannot remove your own admin role");
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.targetUserId).eq("role", "admin");
    }
    return { ok: true };
  });
