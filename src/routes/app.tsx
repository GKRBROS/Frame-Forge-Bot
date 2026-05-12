import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Sparkles, MessageSquare, Database, Settings, Shield, BarChart3,
  Plus, Upload, Trash2, LogOut, Send, FileText, AlertCircle, CheckCircle2, Loader2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  listDocuments, ingestText, ingestUploadedFile, deleteDocument, toggleDocument,
  getAiSettings, updateAiSettings, listConversations, getMessages, createConversation,
  deleteConversation, askQuestion, getMyRole, ensureAdminBootstrap, getAnalytics,
  listUsers, setUserAdmin,
} from "@/lib/rag.functions";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "KnowledgeScope AI — Workspace" }] }),
  component: AppShell,
});

type Tab = "chat" | "knowledge" | "analytics" | "admin" | "settings";

function AppShell() {
  const { user, loading, signOut } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("chat");
  const ensureAdmin = useServerFn(ensureAdminBootstrap);
  const roleFn = useServerFn(getMyRole);

  const role = useQuery({
    queryKey: ["role"],
    queryFn: () => roleFn(),
    enabled: !!user,
  });

  useEffect(() => {
    if (user) ensureAdmin().then(() => role.refetch()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!loading && !user) nav({ to: "/login" });
  }, [user, loading, nav]);

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground"><Loader2 className="animate-spin" /></div>;
  }

  const isAdmin = role.data?.isAdmin ?? false;

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; admin?: boolean }[] = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "knowledge", label: "Knowledge", icon: Database },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "admin", label: "Admin", icon: Shield, admin: true },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 glass border-r border-border p-4 flex flex-col gap-2">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold mb-6 px-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <span className="text-gradient">KnowledgeScope</span>
        </Link>
        {tabs.filter((t) => !t.admin || isAdmin).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${tab === t.id ? "bg-primary/15 text-primary border border-primary/30" : "hover:bg-secondary/50"}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
        <div className="mt-auto pt-4 border-t border-border">
          <div className="text-xs text-muted-foreground px-2 mb-2 truncate">{user.email}</div>
          {isAdmin && <div className="text-xs px-2 mb-2"><span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary">Admin</span></div>}
          <button onClick={() => signOut()} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-secondary/50">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">
        {tab === "chat" && <ChatTab />}
        {tab === "knowledge" && <KnowledgeTab />}
        {tab === "analytics" && <AnalyticsTab />}
        {tab === "admin" && isAdmin && <AdminTab />}
        {tab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}

// ============ CHAT ============
function ChatTab() {
  const qc = useQueryClient();
  const listConv = useServerFn(listConversations);
  const getMsg = useServerFn(getMessages);
  const newConv = useServerFn(createConversation);
  const delConv = useServerFn(deleteConversation);
  const ask = useServerFn(askQuestion);

  const convs = useQuery({ queryKey: ["convs"], queryFn: () => listConv() });
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId && convs.data?.[0]) setActiveId(convs.data[0].id);
  }, [convs.data, activeId]);

  const msgs = useQuery({
    queryKey: ["msgs", activeId],
    queryFn: () => getMsg({ data: { conversationId: activeId! } }),
    enabled: !!activeId,
  });

  const askM = useMutation({
    mutationFn: (q: string) => ask({ data: { conversationId: activeId!, question: q } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["msgs", activeId] });
      qc.invalidateQueries({ queryKey: ["convs"] });
    },
  });

  async function newChat() {
    const c = await newConv({ data: {} });
    await convs.refetch();
    setActiveId(c.id);
  }

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }); }, [msgs.data, askM.isPending]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || askM.isPending) return;
    let convId = activeId;
    if (!convId) {
      const c = await newConv({ data: { title: input.slice(0, 60) } });
      convId = c.id;
      setActiveId(convId);
      await convs.refetch();
    }
    const q = input;
    setInput("");
    // optimistic
    qc.setQueryData(["msgs", convId], (old: any) => [
      ...(old ?? []),
      { id: "tmp", role: "user", content: q, created_at: new Date().toISOString() },
    ]);
    askM.mutate(q);
  }

  return (
    <div className="h-screen flex">
      <div className="w-72 border-r border-border p-3 flex flex-col gap-2 overflow-y-auto">
        <button onClick={newChat} className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-hero-gradient text-primary-foreground text-sm font-medium glow-hover">
          <Plus className="w-4 h-4" /> New chat
        </button>
        {(convs.data ?? []).map((c) => (
          <div key={c.id} className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm ${activeId === c.id ? "bg-primary/10 border border-primary/30" : "hover:bg-secondary/50"}`}
            onClick={() => setActiveId(c.id)}>
            <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="truncate flex-1">{c.title}</span>
            <button onClick={(e) => { e.stopPropagation(); delConv({ data: { id: c.id } }).then(() => { if (activeId === c.id) setActiveId(null); convs.refetch(); }); }}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {convs.data?.length === 0 && <div className="text-xs text-muted-foreground px-3 py-4">No conversations yet.</div>}
      </div>

      <div className="flex-1 flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8 scroll-fade">
          <div className="max-w-3xl mx-auto space-y-6">
            {(!msgs.data || msgs.data.length === 0) && !askM.isPending && (
              <div className="text-center py-20">
                <Sparkles className="w-10 h-10 text-primary mx-auto mb-4" />
                <h2 className="text-2xl font-display font-bold mb-2">Ask your knowledge base</h2>
                <p className="text-sm text-muted-foreground">Answers come strictly from documents you've uploaded.</p>
              </div>
            )}
            {msgs.data?.map((m: any) => <MessageBubble key={m.id} m={m} />)}
            {askM.isPending && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-hero-gradient flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4 text-primary-foreground" /></div>
                <div className="glass-card rounded-2xl px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching knowledge…
                </div>
              </div>
            )}
          </div>
        </div>
        <form onSubmit={send} className="border-t border-border p-4">
          <div className="max-w-3xl mx-auto flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything from your knowledge base…"
              className="flex-1 px-4 py-3 rounded-xl bg-input border border-border focus:border-primary outline-none" />
            <button disabled={askM.isPending || !input.trim()} className="px-5 py-3 rounded-xl bg-hero-gradient text-primary-foreground font-medium glow-hover disabled:opacity-50">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: any }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isUser ? "bg-secondary" : "bg-hero-gradient"}`}>
        {isUser ? <span className="text-xs font-bold">You</span> : <Sparkles className="w-4 h-4 text-primary-foreground" />}
      </div>
      <div className={`glass-card rounded-2xl px-4 py-3 max-w-[80%] ${m.rejected ? "border-warning/40" : ""}`}>
        <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap">{m.content}</div>
        {m.confidence != null && !isUser && (
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-2">
            {m.rejected ? <AlertCircle className="w-3 h-3 text-warning" /> : <CheckCircle2 className="w-3 h-3 text-success" />}
            confidence {(Number(m.confidence) * 100).toFixed(0)}% · {m.model ?? ""}
          </div>
        )}
        {Array.isArray(m.citations) && m.citations.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {m.citations.map((c: any) => (
              <div key={c.n} className="text-xs glass rounded-lg px-2.5 py-1.5">
                <span className="text-primary font-mono">[{c.n}]</span> <span className="font-medium">{c.document_title}</span>
                <div className="text-muted-foreground mt-1 line-clamp-2">{c.excerpt}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ KNOWLEDGE ============
function KnowledgeTab() {
  const qc = useQueryClient();
  const list = useServerFn(listDocuments);
  const ingestT = useServerFn(ingestText);
  const ingestF = useServerFn(ingestUploadedFile);
  const del = useServerFn(deleteDocument);
  const tog = useServerFn(toggleDocument);

  const docs = useQuery({ queryKey: ["docs"], queryFn: () => list() });
  const [mode, setMode] = useState<"upload" | "paste">("paste");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submitText(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await ingestT({ data: { title, content: text } });
      setTitle(""); setText(""); qc.invalidateQueries({ queryKey: ["docs"] });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function uploadFile(file: File) {
    setErr(""); setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const path = `${userData.user!.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("knowledge-documents").upload(path, file);
      if (upErr) throw upErr;
      await ingestF({ data: { filePath: path, title: file.name, mimeType: file.type || "text/plain" } });
      qc.invalidateQueries({ queryKey: ["docs"] });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="h-screen overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-display font-bold mb-2">Knowledge Base</h1>
        <p className="text-muted-foreground mb-8">Upload .txt .md .csv .json files or paste text. Each document is chunked and indexed for retrieval.</p>

        <div className="glass-card rounded-2xl p-6 mb-8">
          <div className="flex gap-2 mb-4">
            <button onClick={() => setMode("paste")} className={`px-4 py-2 rounded-lg text-sm ${mode === "paste" ? "bg-primary/15 text-primary border border-primary/30" : "glass"}`}>Paste text</button>
            <button onClick={() => setMode("upload")} className={`px-4 py-2 rounded-lg text-sm ${mode === "upload" ? "bg-primary/15 text-primary border border-primary/30" : "glass"}`}>Upload file</button>
          </div>
          {mode === "paste" ? (
            <form onSubmit={submitText} className="space-y-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title" required
                className="w-full px-4 py-3 rounded-lg bg-input border border-border focus:border-primary outline-none" />
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste your knowledge content here…" required rows={8}
                className="w-full px-4 py-3 rounded-lg bg-input border border-border focus:border-primary outline-none font-mono text-sm" />
              <button disabled={busy} className="px-5 py-2.5 rounded-lg bg-hero-gradient text-primary-foreground font-medium glow-hover disabled:opacity-50">
                {busy ? "Indexing…" : "Add to knowledge base"}
              </button>
            </form>
          ) : (
            <label className="block border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary transition">
              <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
              <div className="font-medium">Click to upload</div>
              <div className="text-xs text-muted-foreground mt-1">.txt .md .csv .json .xml .html — up to ~2 MB</div>
              <input type="file" className="hidden" accept=".txt,.md,.csv,.json,.xml,.html,text/*"
                onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
            </label>
          )}
          {err && <div className="text-sm text-destructive mt-3">{err}</div>}
        </div>

        <div className="space-y-2">
          {(docs.data ?? []).map((d: any) => (
            <div key={d.id} className="glass-card rounded-xl p-4 flex items-center gap-4">
              <FileText className="w-5 h-5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{d.title}</div>
                <div className="text-xs text-muted-foreground">
                  {d.chunk_count} chunks · {d.status}
                  {d.error_message && <span className="text-destructive"> — {d.error_message}</span>}
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${
                d.status === "ready" ? "bg-success/20 text-success" :
                d.status === "processing" ? "bg-warning/20 text-warning" :
                d.status === "failed" ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground"}`}>
                {d.status}
              </span>
              <button onClick={() => tog({ data: { id: d.id, enabled: !d.enabled } }).then(() => qc.invalidateQueries({ queryKey: ["docs"] }))}
                className="text-xs px-2 py-1 rounded glass">{d.enabled ? "Enabled" : "Disabled"}</button>
              <button onClick={() => del({ data: { id: d.id } }).then(() => qc.invalidateQueries({ queryKey: ["docs"] }))}
                className="text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {docs.data?.length === 0 && <div className="text-sm text-muted-foreground text-center py-12">No documents yet.</div>}
        </div>
      </div>
    </div>
  );
}

// ============ ANALYTICS ============
function AnalyticsTab() {
  const fn = useServerFn(getAnalytics);
  const a = useQuery({ queryKey: ["analytics"], queryFn: () => fn() });
  if (a.isLoading) return <div className="p-8"><Loader2 className="animate-spin" /></div>;
  const t = a.data?.totals;
  if (!t) return null;
  const cards = [
    { label: "Total queries", value: t.queries },
    { label: "Out-of-scope rejected", value: t.rejected },
    { label: "Avg confidence", value: `${(t.avgConfidence * 100).toFixed(0)}%` },
    { label: "Avg latency", value: `${t.avgLatency.toFixed(0)} ms` },
    { label: "Tokens in", value: t.tokensIn.toLocaleString() },
    { label: "Tokens out", value: t.tokensOut.toLocaleString() },
    { label: "Documents", value: t.documents },
    { label: "Chunks indexed", value: t.chunks },
  ];
  return (
    <div className="h-screen overflow-y-auto p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-display font-bold mb-2">Analytics</h1>
        <p className="text-muted-foreground mb-8">{a.data.isAdmin ? "Workspace-wide stats" : "Your usage"}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {cards.map((c) => (
            <div key={c.label} className="glass-card rounded-xl p-5">
              <div className="text-xs text-muted-foreground mb-1">{c.label}</div>
              <div className="text-2xl font-display font-bold">{c.value}</div>
            </div>
          ))}
        </div>

        <div className="glass-card rounded-2xl p-6 mb-6">
          <h2 className="font-display font-semibold mb-4">Last 14 days</h2>
          <div className="flex items-end gap-2 h-40">
            {(a.data.daily ?? []).map((d: any) => {
              const max = Math.max(1, ...a.data.daily.map((x: any) => x.queries));
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col justify-end h-32">
                    <div className="bg-primary/40 rounded-t" style={{ height: `${(d.queries / max) * 100}%` }} />
                    <div className="bg-warning/60" style={{ height: `${(d.rejected / max) * 100}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground">{d.day.slice(5)}</div>
                </div>
              );
            })}
            {a.data.daily?.length === 0 && <div className="text-sm text-muted-foreground">No activity yet.</div>}
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6">
          <h2 className="font-display font-semibold mb-4">Recent rejected queries (hallucination prevention)</h2>
          <div className="space-y-2">
            {(a.data.recentRejected ?? []).map((r: any, i: number) => (
              <div key={i} className="text-sm glass rounded-lg px-3 py-2">
                <div className="truncate">{r.question}</div>
                <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()} · confidence {(Number(r.confidence) * 100).toFixed(0)}%</div>
              </div>
            ))}
            {a.data.recentRejected?.length === 0 && <div className="text-sm text-muted-foreground">None — model has never been forced to reject.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ ADMIN ============
const MODELS = [
  "deepseek/deepseek-chat-v3.1",
  "deepseek/deepseek-r1",
  "qwen/qwen3-32b",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o-mini",
  "google/gemini-2.5-flash",
];

function AdminTab() {
  const qc = useQueryClient();
  const getS = useServerFn(getAiSettings);
  const setS = useServerFn(updateAiSettings);
  const lUsers = useServerFn(listUsers);
  const setAdmin = useServerFn(setUserAdmin);

  const settings = useQuery({ queryKey: ["aisettings"], queryFn: () => getS() });
  const users = useQuery({ queryKey: ["users"], queryFn: () => lUsers() });
  const upd = useMutation({
    mutationFn: (patch: any) => setS({ data: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aisettings"] }),
  });

  if (settings.isLoading || !settings.data) return <div className="p-8"><Loader2 className="animate-spin" /></div>;
  const s = settings.data;

  const toggle = (key: string) => upd.mutate({ [key]: !s[key as keyof typeof s] });

  return (
    <div className="h-screen overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold mb-2">Admin</h1>
          <p className="text-muted-foreground">Model selection, AI controls, and user roles.</p>
        </div>

        <div className="glass-card rounded-2xl p-6">
          <h2 className="font-display font-semibold mb-4">Model configuration</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-muted-foreground">Active model (OpenRouter)</span>
              <select value={s.active_model} onChange={(e) => upd.mutate({ active_model: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-input border border-border">
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Fallback model</span>
              <select value={s.fallback_model ?? ""} onChange={(e) => upd.mutate({ fallback_model: e.target.value || null })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-input border border-border">
                <option value="">(none)</option>
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Temperature: {s.temperature}</span>
              <input type="range" min={0} max={1} step={0.05} value={s.temperature}
                onChange={(e) => upd.mutate({ temperature: Number(e.target.value) })} className="w-full mt-2" />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Max tokens: {s.max_tokens}</span>
              <input type="range" min={128} max={4096} step={64} value={s.max_tokens}
                onChange={(e) => upd.mutate({ max_tokens: Number(e.target.value) })} className="w-full mt-2" />
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs text-muted-foreground">Confidence threshold: {(Number(s.confidence_threshold) * 100).toFixed(0)}% — answers below this are rejected</span>
              <input type="range" min={0} max={1} step={0.01} value={s.confidence_threshold}
                onChange={(e) => upd.mutate({ confidence_threshold: Number(e.target.value) })} className="w-full mt-2" />
            </label>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6">
          <h2 className="font-display font-semibold mb-4">AI control panel</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {[
              { k: "strict_knowledge", label: "Strict knowledge mode", desc: "Only answer from indexed docs" },
              { k: "out_of_scope_rejection", label: "Out-of-scope rejection", desc: "Reply with refusal when no match" },
              { k: "hallucination_prevention", label: "Hallucination prevention", desc: "Reinforced via system prompt" },
              { k: "allow_internet", label: "Internet access", desc: "Disabled in v1", disabled: true },
              { k: "allow_web_scraping", label: "Web scraping", desc: "Disabled in v1", disabled: true },
              { k: "enable_ocr", label: "OCR extraction", desc: "Roadmap" },
              { k: "image_extraction", label: "Image extraction", desc: "Roadmap" },
            ].map((t) => (
              <div key={t.k} className="flex items-center justify-between glass rounded-lg p-3">
                <div>
                  <div className="text-sm font-medium">{t.label}</div>
                  <div className="text-xs text-muted-foreground">{t.desc}</div>
                </div>
                <button disabled={t.disabled} onClick={() => toggle(t.k)}
                  className={`w-10 h-6 rounded-full transition ${s[t.k as keyof typeof s] ? "bg-primary" : "bg-secondary"} disabled:opacity-40`}>
                  <span className={`block w-5 h-5 bg-white rounded-full transition ${s[t.k as keyof typeof s] ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6">
          <h2 className="font-display font-semibold mb-4">Users</h2>
          <div className="space-y-2">
            {(users.data ?? []).map((u: any) => (
              <div key={u.user_id} className="flex items-center justify-between glass rounded-lg p-3">
                <div>
                  <div className="text-sm font-medium">{u.display_name ?? u.user_id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">{u.roles.join(", ")}</div>
                </div>
                <button onClick={() => setAdmin({ data: { targetUserId: u.user_id, makeAdmin: !u.roles.includes("admin") } }).then(() => users.refetch())}
                  className="text-xs px-3 py-1.5 rounded-lg glass hover:border-primary">
                  {u.roles.includes("admin") ? "Revoke admin" : "Make admin"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ SETTINGS ============
function SettingsTab() {
  const { user } = useAuth();
  return (
    <div className="h-screen overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-display font-bold mb-2">Settings</h1>
        <p className="text-muted-foreground mb-8">Account info.</p>
        <div className="glass-card rounded-2xl p-6 space-y-3">
          <div><div className="text-xs text-muted-foreground">Email</div><div>{user?.email}</div></div>
          <div><div className="text-xs text-muted-foreground">User ID</div><div className="font-mono text-xs">{user?.id}</div></div>
        </div>
      </div>
    </div>
  );
}
