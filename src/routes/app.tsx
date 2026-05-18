import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "react-toastify";
import {
  Sparkles, Database, Settings, Shield, BarChart3,
  Upload, Trash2, LogOut, FileText, AlertCircle, CheckCircle2, Loader2, Download,
  MessageSquare, Terminal, HelpCircle, Calendar, Cpu, Coins, ChevronDown, ChevronUp,
  Copy, Check, Filter, XCircle, Search, Clock, AlertTriangle
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  listDocuments, ingestText, ingestUploadedFile, ingestUrl, deleteDocument, toggleDocument,
  getAiSettings, updateAiSettings, askQuestion, getMyRole, ensureAdminBootstrap, getAnalytics,
  listUsers, setUserAdmin,
} from "@/lib/rag.functions";
import { Mermaid } from "@/components/Mermaid";
import { ThemeToggle } from "@/components/ThemeToggle";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "KnowledgeScope AI — Workspace" }] }),
  component: AppShell,
});

type Tab = "chat" | "knowledge" | "analytics" | "admin" | "settings" | "logs";

function AppShell() {
  const { user, loading, signOut } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("knowledge");
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
    { id: "knowledge", label: "Knowledge", icon: Database },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "logs", label: "Logs", icon: Terminal },
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
        <div className="mt-auto pt-4 border-t border-border space-y-2">
          <div className="flex items-center justify-between px-2 gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground truncate">{user.email}</div>
              {isAdmin && <div className="text-[10px] mt-0.5"><span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary font-semibold">Admin</span></div>}
            </div>
            <ThemeToggle className="scale-90 shrink-0" />
          </div>
          <button onClick={() => signOut()} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-secondary/50 transition">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">
        {tab === "knowledge" && <KnowledgeTab />}
        {tab === "analytics" && <AnalyticsTab />}
        {tab === "logs" && <LogsTab />}
        {tab === "admin" && isAdmin && <AdminTab />}
        {tab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}

function MessageBubble({ m, showCitations }: { m: any; showCitations?: boolean }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isUser ? "bg-secondary" : "bg-hero-gradient"}`}>
        {isUser ? <span className="text-xs font-bold">You</span> : <Sparkles className="w-4 h-4 text-primary-foreground" />}
      </div>
      <div className={`glass-card rounded-2xl px-4 py-3 max-w-[80%] ${m.rejected ? "border-warning/40" : ""}`}>
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code: ({ node, className, children, ...props }) => {
                const match = /language-(\w+)/.exec(className || '');
                const isMermaid = match && match[1] === 'mermaid';
                if (isMermaid) {
                  return <Mermaid chart={String(children).replace(/\n$/, '')} />;
                }
                return <code className="rounded bg-black/20 px-1 py-0.5 text-[0.92em]" {...props}>{children}</code>;
              },
            }}
          >
            {m.content}
          </ReactMarkdown>
        </div>
        {m.image_url && (
          <div className="mt-4 group relative rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-black/20">
            <img 
              src={m.image_url} 
              alt="Generated result" 
              className="w-full h-auto object-contain max-h-[700px] block" 
            />
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={async () => {
                  try {
                    const response = await fetch(m.image_url!);
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `diagram-${Date.now()}.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  } catch (err) {
                    window.open(m.image_url, '_blank');
                  }
                }}
                className="p-2 rounded-lg bg-black/60 backdrop-blur-md border border-white/20 text-white hover:bg-primary transition shadow-xl"
                title="Download image"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        {m.confidence != null && !isUser && (
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-2">
            {m.rejected ? <AlertCircle className="w-3 h-3 text-warning" /> : <CheckCircle2 className="w-3 h-3 text-success" />}
            confidence {(Number(m.confidence) * 100).toFixed(0)}%
          </div>
        )}
        {showCitations && m.citations && m.citations.length > 0 && (
          <div className="mt-3 space-y-2">
            {m.citations.map((c: any) => (
              <div key={c.n} className="glass rounded-lg p-2.5 text-xs flex gap-2">
                <span className="shrink-0 w-5 h-5 rounded grid place-items-center bg-primary/15 text-primary font-semibold">{c.n}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 font-medium text-foreground truncate">
                    <FileText className="w-3 h-3" /> {c.document_title}
                  </div>
                  <div className="text-muted-foreground line-clamp-2 mt-0.5">{c.excerpt}</div>
                </div>
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
  const ingestU = useServerFn(ingestUrl);
  const del = useServerFn(deleteDocument);
  const tog = useServerFn(toggleDocument);

  const docs = useQuery({ queryKey: ["docs"], queryFn: () => list() });
  const [mode, setMode] = useState<"upload" | "paste" | "url">("paste");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function handleToggle(id: string, enabled: boolean, docTitle: string) {
    try {
      await tog({ data: { id, enabled } });
      toast.success(enabled ? `Enabled “${docTitle}”` : `Disabled “${docTitle}”`);
      qc.invalidateQueries({ queryKey: ["docs"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to toggle document status");
    }
  }

  async function handleDelete(id: string, docTitle: string) {
    try {
      await del({ data: { id } });
      toast.success(`Deleted document “${docTitle}”`);
      qc.invalidateQueries({ queryKey: ["docs"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to delete document");
    }
  }

  async function submitText(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setOk(""); setBusy(true);
    try {
      await ingestT({ data: { title, content: text } });
      setTitle(""); setText("");
      toast.success("Document text indexed successfully!");
      qc.invalidateQueries({ queryKey: ["docs"] });
    } catch (e: any) { 
      setErr(e.message); 
      toast.error(e.message);
    } finally { 
      setBusy(false); 
    }
  }

  async function submitUrl(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setOk(""); setBusy(true);
    try {
      const r = await ingestU({ data: { url } });
      setUrl("");
      toast.success(`Scraped “${r.title}” — ${r.chunkCount} chunks successfully!`);
      qc.invalidateQueries({ queryKey: ["docs"] });
    } catch (e: any) { 
      setErr(e.message); 
      toast.error(e.message);
    } finally { 
      setBusy(false); 
    }
  }

  async function uploadFiles(files: File[]) {
    setErr("");
    setOk("");
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user!.id;
      const results = await Promise.allSettled(
        files.map(async (file) => {
          const path = `${userId}/${Date.now()}-${file.name}`;
          const { error: upErr } = await supabase.storage.from("knowledge-documents").upload(path, file);
          if (upErr) throw upErr;
          await ingestF({ data: { filePath: path, title: file.name, mimeType: file.type || "application/octet-stream" } });
          return file.name;
        }),
      );

      const succeeded = results.filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled");
      const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

      if (succeeded.length > 0) {
        const msg = succeeded.length === 1
          ? `Indexed ${succeeded[0].value}`
          : `Indexed ${succeeded.length} files: ${succeeded.map((result) => result.value).join(", ")}`;
        toast.success(msg);
      }
      if (failed.length > 0) {
        const msg = failed.length === 1
          ? failed[0].reason instanceof Error
            ? failed[0].reason.message
            : String(failed[0].reason)
          : `${failed.length} files failed to upload or index`;
        toast.error(msg);
      }
      if (succeeded.length > 0) {
        qc.invalidateQueries({ queryKey: ["docs"] });
      }
    } catch (e: any) {
      setErr(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-screen overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-display font-bold mb-2">Knowledge Base</h1>
        <p className="text-muted-foreground mb-8">Upload PDFs, Word docs, text, CSV, images (OCR), scrape a web page, or paste text directly.</p>

        <div className="glass-card rounded-2xl p-6 mb-8">
          <div className="flex gap-2 mb-4 flex-wrap">
            <button onClick={() => setMode("paste")} className={`px-4 py-2 rounded-lg text-sm ${mode === "paste" ? "bg-primary/15 text-primary border border-primary/30" : "glass"}`}>Paste text</button>
            <button onClick={() => setMode("upload")} className={`px-4 py-2 rounded-lg text-sm ${mode === "upload" ? "bg-primary/15 text-primary border border-primary/30" : "glass"}`}>Upload file</button>
            <button onClick={() => setMode("url")} className={`px-4 py-2 rounded-lg text-sm ${mode === "url" ? "bg-primary/15 text-primary border border-primary/30" : "glass"}`}>Scrape URL</button>
          </div>
          {mode === "paste" && (
            <form onSubmit={submitText} className="space-y-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title" required
                className="w-full px-4 py-3 rounded-lg bg-input border border-border focus:border-primary outline-none" />
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste your knowledge content here…" required rows={8}
                className="w-full px-4 py-3 rounded-lg bg-input border border-border focus:border-primary outline-none font-mono text-sm" />
              <button disabled={busy} className="px-5 py-2.5 rounded-lg bg-hero-gradient text-primary-foreground font-medium glow-hover disabled:opacity-50">
                {busy ? "Indexing…" : "Add to knowledge base"}
              </button>
            </form>
          )}
          {mode === "upload" && (
            <label className="block border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary transition">
              <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
              <div className="font-medium">{busy ? "Processing…" : "Click to upload"}</div>
              <div className="text-xs text-muted-foreground mt-1">PDF · DOCX · TXT · MD · CSV · JSON · HTML · PNG/JPG (OCR) — any format</div>
              <input
                type="file"
                className="hidden"
                accept="*/*"
                multiple
                disabled={busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.currentTarget.value = "";
                  if (files.length > 0) uploadFiles(files);
                }}
              />
            </label>
          )}
          {mode === "url" && (
            <form onSubmit={submitUrl} className="space-y-3">
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/article" required
                className="w-full px-4 py-3 rounded-lg bg-input border border-border focus:border-primary outline-none" />
              <button disabled={busy} className="px-5 py-2.5 rounded-lg bg-hero-gradient text-primary-foreground font-medium glow-hover disabled:opacity-50">
                {busy ? "Scraping…" : "Scrape & index page"}
              </button>
            </form>
          )}
          {err && <div className="text-sm text-destructive mt-3">{err}</div>}
          {ok && <div className="text-sm text-success mt-3">{ok}</div>}
        </div>

        <div className="space-y-2">
          {(docs.data ?? []).map((d: any) => (
            <div key={d.id} className="glass-card rounded-xl p-4 flex items-center gap-4">
              <FileText className="w-5 h-5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{d.title}</div>
                <div className="text-xs text-muted-foreground">
                  {d.source_type ?? "text"} · {d.chunk_count} chunks · {d.status}
                  {d.error_message && <span className="text-destructive"> — {d.error_message}</span>}
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${
                d.status === "ready" ? "bg-success/20 text-success" :
                d.status === "processing" ? "bg-warning/20 text-warning" :
                d.status === "failed" ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground"}`}>
                {d.status}
              </span>
              <button onClick={() => handleToggle(d.id, !d.enabled, d.title)}
                className="text-xs px-2 py-1 rounded glass">{d.enabled ? "Enabled" : "Disabled"}</button>
              <button onClick={() => handleDelete(d.id, d.title)}
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
  const [logSearch, setLogSearch] = useState("");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");

  const filteredLogs = useMemo(() => {
    if (!a.data?.recentLogs) return [];
    const query = logSearch.trim().toLowerCase();
    const fromMs = logFrom ? new Date(`${logFrom}T00:00:00`).getTime() : null;
    const toMs = logTo ? new Date(`${logTo}T23:59:59.999`).getTime() : null;

    return (a.data.recentLogs ?? []).filter((log: any) => {
      const createdAt = new Date(log.created_at).getTime();
      const text = [log.question, log.event_label, log.event_type, log.model]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesText = !query || text.includes(query);
      const matchesFrom = fromMs == null || createdAt >= fromMs;
      const matchesTo = toMs == null || createdAt <= toMs;
      return matchesText && matchesFrom && matchesTo;
    });
  }, [a.data?.recentLogs, logFrom, logSearch, logTo]);

  if (a.isLoading || !a.data) return <div className="p-8"><Loader2 className="animate-spin" /></div>;
  const data = a.data;
  const t = data.totals;
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

        <div className="glass-card rounded-2xl p-6 mt-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-4">
            <div>
              <h2 className="font-display font-semibold">Activity logs</h2>
              <p className="text-xs text-muted-foreground">All chat opens and question logs with search and date filtering.</p>
            </div>
            <div className="text-xs text-muted-foreground">
              Showing {filteredLogs.length} of {(a.data.recentLogs ?? []).length} entries
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3 mb-4">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Search</span>
              <input
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Search question, model, or label"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-border outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">From date</span>
              <input
                type="date"
                value={logFrom}
                onChange={(e) => setLogFrom(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-border outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">To date</span>
              <input
                type="date"
                value={logTo}
                onChange={(e) => setLogTo(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-border outline-none focus:border-primary"
              />
            </label>
          </div>
          <div className="space-y-2 max-h-112 overflow-y-auto pr-1">
            {filteredLogs.map((log: any, i: number) => {
              const isOpen = log.event_type === "chat_open";
              return (
                <div key={`${log.created_at}-${i}`} className="glass rounded-lg px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {isOpen ? "Chat opened" : "Question asked"}
                        {log.event_label ? <span className="text-muted-foreground font-normal"> · {log.event_label}</span> : null}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {log.question}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <div>{new Date(log.created_at).toLocaleString()}</div>
                      <div>
                        {isOpen ? "open" : `${(Number(log.confidence ?? 0) * 100).toFixed(0)}%`} · {log.latency_ms ?? 0} ms
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="px-2 py-0.5 rounded-full bg-secondary/60">{log.event_type ?? "question"}</span>
                    {log.rejected ? <span className="px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">rejected</span> : null}
                    {log.model ? <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary">{log.model}</span> : null}
                  </div>
                </div>
              );
            })}
            {filteredLogs.length === 0 && <div className="text-sm text-muted-foreground">No logs match the current filters.</div>}
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aisettings"] });
      toast.success("AI Configuration updated successfully!");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update configuration");
    }
  });

  async function handleAdminRoleToggle(targetUserId: string, display_name: string, makeAdmin: boolean) {
    try {
      await setAdmin({ data: { targetUserId, makeAdmin } });
      toast.success(makeAdmin ? `Granted administrator role to “${display_name}”` : `Revoked administrator role from “${display_name}”`);
      users.refetch();
    } catch (e: any) {
      toast.error(e.message || "Failed to modify user role");
    }
  }

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
              { k: "strict_knowledge", label: "Strict knowledge mode", desc: "Only answer from indexed docs (web fallback only when allowed below)" },
              { k: "out_of_scope_rejection", label: "Out-of-scope rejection", desc: "Reply with refusal when no match found" },
              { k: "hallucination_prevention", label: "Hallucination prevention", desc: "Reinforced via system prompt" },
              { k: "allow_internet", label: "Internet access", desc: "Live web search fallback when KB confidence is low" },
              { k: "allow_web_scraping", label: "Web scraping", desc: "Allow indexing pages by URL in Knowledge tab" },
              { k: "enable_ocr", label: "OCR (images)", desc: "Vision model extracts text from uploaded images" },
              { k: "image_extraction", label: "Image extraction", desc: "Roadmap" },
            ].map((t) => (
              <div key={t.k} className="flex items-center justify-between glass rounded-lg p-3">
                <div>
                  <div className="text-sm font-medium">{t.label}</div>
                  <div className="text-xs text-muted-foreground">{t.desc}</div>
                </div>
                <button onClick={() => toggle(t.k)}
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
                <button onClick={() => handleAdminRoleToggle(u.user_id, u.display_name ?? u.user_id.slice(0, 8), !u.roles.includes("admin"))}
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

// ============ LOGS ============
function LogsTab() {
  const fn = useServerFn(getAnalytics);
  const a = useQuery({ queryKey: ["analytics"], queryFn: () => fn() });
  const [logSearch, setLogSearch] = useState("");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<"all" | "question" | "chat_open" | "rejected">("all");
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
    toast.success("Copied to clipboard!");
  };

  const toggleExpand = (id: string) => {
    setExpandedLogIds((p) => ({ ...p, [id]: !p[id] }));
  };

  const filteredLogs = useMemo(() => {
    if (!a.data?.recentLogs) return [];
    const query = logSearch.trim().toLowerCase();
    const fromMs = logFrom ? new Date(`${logFrom}T00:00:00`).getTime() : null;
    const toMs = logTo ? new Date(`${logTo}T23:59:59.999`).getTime() : null;

    return (a.data.recentLogs ?? []).filter((log: any) => {
      const createdAt = new Date(log.created_at).getTime();
      
      // Filter by type
      if (eventTypeFilter === "question" && log.event_type !== "question") return false;
      if (eventTypeFilter === "chat_open" && log.event_type !== "chat_open") return false;
      if (eventTypeFilter === "rejected" && !log.rejected) return false;

      const text = [log.question, log.event_label, log.event_type, log.model]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesText = !query || text.includes(query);
      const matchesFrom = fromMs == null || createdAt >= fromMs;
      const matchesTo = toMs == null || createdAt <= toMs;
      return matchesText && matchesFrom && matchesTo;
    });
  }, [a.data?.recentLogs, logFrom, logSearch, logTo, eventTypeFilter]);

  const stats = useMemo(() => {
    const total = filteredLogs.length;
    const chatOpens = filteredLogs.filter((l) => l.event_type === "chat_open").length;
    const questions = filteredLogs.filter((l) => l.event_type === "question").length;
    const rejections = filteredLogs.filter((l) => l.rejected).length;
    
    const latencyLogs = filteredLogs.filter((l) => l.latency_ms);
    const avgLatency = latencyLogs.length
      ? Math.round(latencyLogs.reduce((s, l) => s + (l.latency_ms ?? 0), 0) / latencyLogs.length)
      : 0;

    const totalTokens = filteredLogs.reduce((s, l) => s + (l.tokens_in ?? 0) + (l.tokens_out ?? 0), 0);

    return { total, chatOpens, questions, rejections, avgLatency, totalTokens };
  }, [filteredLogs]);

  if (a.isLoading || !a.data) {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const hasActiveFilters = logSearch || logFrom || logTo || eventTypeFilter !== "all";

  const clearFilters = () => {
    setLogSearch("");
    setLogFrom("");
    setLogTo("");
    setEventTypeFilter("all");
    toast.info("Filters cleared");
  };

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-8 animate-fade-in bg-background">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/40 pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 grid place-items-center text-primary">
                <Terminal className="w-4 h-4" />
              </div>
              <h1 className="text-3xl font-display font-bold">Activity Logs</h1>
            </div>
            <p className="text-muted-foreground text-sm">
              Real-time monitoring console for all user chats, model questions, latencies, and system events.
            </p>
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs px-3.5 py-2 rounded-xl glass hover:border-destructive/30 hover:text-destructive flex items-center gap-1.5 self-start md:self-center transition"
            >
              <XCircle className="w-3.5 h-3.5" /> Clear active filters
            </button>
          )}
        </div>

        {/* Dashboard Analytics Bar */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          <div className="glass-card rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Total Events</div>
              <div className="text-xl font-bold font-mono text-foreground mt-0.5">{stats.total}</div>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Chat Opens</div>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">{stats.chatOpens}</div>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Questions</div>
              <div className="text-xl font-bold font-mono text-blue-400 mt-0.5">{stats.questions}</div>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-400 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Rejections</div>
              <div className="text-xl font-bold font-mono text-rose-400 mt-0.5">{stats.rejections}</div>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4 col-span-2 md:col-span-1 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Avg Latency</div>
              <div className="text-xl font-bold font-mono text-amber-400 mt-0.5">{stats.avgLatency}ms</div>
            </div>
          </div>
        </div>

        {/* Filter Console */}
        <div className="glass-card rounded-2xl p-5 shadow-soft border border-border/40">
          <div className="grid gap-4 md:grid-cols-4">
            
            {/* Search input */}
            <div className="relative md:col-span-2">
              <span className="text-xs text-muted-foreground font-semibold mb-1.5 block">Search content</span>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="Search questions, models, labels..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-input border border-border outline-none focus:border-primary transition text-sm"
                />
              </div>
            </div>

            {/* Filter by event type */}
            <div>
              <span className="text-xs text-muted-foreground font-semibold mb-1.5 block">Filter Type</span>
              <div className="relative">
                <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <select
                  value={eventTypeFilter}
                  onChange={(e) => setEventTypeFilter(e.target.value as any)}
                  className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-input border border-border outline-none focus:border-primary transition text-sm appearance-none cursor-pointer"
                >
                  <option value="all">All Events</option>
                  <option value="question">Questions Only</option>
                  <option value="chat_open">Chat Opens Only</option>
                  <option value="rejected">Rejections Only</option>
                </select>
              </div>
            </div>

            {/* Date ranges */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-xs text-muted-foreground font-semibold mb-1.5 block">From</span>
                <input
                  type="date"
                  value={logFrom}
                  onChange={(e) => setLogFrom(e.target.value)}
                  className="w-full px-2.5 py-2.5 rounded-xl bg-input border border-border outline-none focus:border-primary transition text-xs"
                />
              </div>
              <div>
                <span className="text-xs text-muted-foreground font-semibold mb-1.5 block">To</span>
                <input
                  type="date"
                  value={logTo}
                  onChange={(e) => setLogTo(e.target.value)}
                  className="w-full px-2.5 py-2.5 rounded-xl bg-input border border-border outline-none focus:border-primary transition text-xs"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Logs Interactive Accordion */}
        <div className="space-y-3">
          {filteredLogs.map((log: any, i: number) => {
            const uniqueId = `${log.created_at}-${i}`;
            const isOpenEvent = log.event_type === "chat_open";
            const isExpanded = !!expandedLogIds[uniqueId];

            // Latency Speed Grader
            const latency = log.latency_ms ?? 0;
            const latencyColor =
              latency < 500
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/10"
                : latency < 2000
                ? "text-amber-400 bg-amber-500/10 border-amber-500/10"
                : "text-rose-400 bg-rose-500/10 border-rose-500/10";

            // Confidence Score Grader
            const confidence = Number(log.confidence ?? 0);
            const confColor =
              log.rejected
                ? "bg-rose-500"
                : confidence > 0.75
                ? "bg-emerald-500"
                : confidence > 0.4
                ? "bg-amber-500"
                : "bg-rose-500";

            return (
              <div
                key={uniqueId}
                className={`glass rounded-2xl border transition duration-200 shadow-sm overflow-hidden ${
                  isExpanded ? "border-primary/45 bg-black/15 shadow-md" : "border-border/30 hover:border-primary/25 bg-black/5"
                }`}
              >
                
                {/* Accordion Trigger Header */}
                <div
                  onClick={() => toggleExpand(uniqueId)}
                  className="p-4 flex items-center justify-between cursor-pointer select-none gap-4 hover:bg-white/5 transition"
                >
                  <div className="min-w-0 flex-1 flex flex-col md:flex-row md:items-center gap-3">
                    
                    {/* Event Type & Action Icon */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isOpenEvent ? (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <MessageSquare className="w-3 h-3" /> Chat Open
                        </span>
                      ) : log.rejected ? (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/15 text-rose-400 border border-rose-500/20">
                          <AlertTriangle className="w-3 h-3 animate-pulse" /> Rejected
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          <Sparkles className="w-3 h-3" /> Query
                        </span>
                      )}
                    </div>

                    {/* Content Snippet */}
                    <div className="min-w-0 flex-1 text-sm font-medium text-foreground truncate max-w-lg">
                      {log.question ? log.question : <span className="text-muted-foreground italic">(Session initialized or empty question)</span>}
                    </div>

                    {/* Metadata summary (time & model) */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0 font-mono">
                      <span>{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {log.model && (
                        <>
                          <span className="text-muted-foreground/30">•</span>
                          <span className="text-[11px] bg-primary/5 px-2 py-0.5 rounded border border-white/5 truncate max-w-36">{log.model.split('/').pop()}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Accordion Arrow Indicator */}
                  <div className="shrink-0 text-muted-foreground hover:text-foreground p-1 transition">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>

                {/* Collapsible Details Content */}
                {isExpanded && (
                  <div className="border-t border-border/30 bg-black/10 px-5 py-5 space-y-4 animate-fade-in text-sm">
                    
                    {/* Performance & Token Metrics Row */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                      
                      {/* Metric: Model */}
                      <div className="glass rounded-xl p-3 flex items-start gap-2.5 border border-white/5 bg-white/5">
                        <Cpu className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <div>
                          <div className="text-[10px] uppercase font-bold text-muted-foreground">OpenRouter Model</div>
                          <div className="font-mono text-xs font-semibold mt-0.5 break-all">
                            {log.model || "System (no model used)"}
                          </div>
                        </div>
                      </div>

                      {/* Metric: Latency */}
                      <div className="glass rounded-xl p-3 flex items-start gap-2.5 border border-white/5 bg-white/5">
                        <Clock className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                        <div>
                          <div className="text-[10px] uppercase font-bold text-muted-foreground">Query Latency</div>
                          {isOpenEvent ? (
                            <div className="text-xs font-semibold mt-0.5 text-muted-foreground">N/A</div>
                          ) : (
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="font-mono text-sm font-semibold">{latency}ms</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wide ${latencyColor}`}>
                                {latency < 500 ? "fast" : latency < 2000 ? "normal" : "slow"}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Metric: Confidence */}
                      <div className="glass rounded-xl p-3 flex items-start gap-2.5 border border-white/5 bg-white/5">
                        <HelpCircle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                        <div className="w-full">
                          <div className="text-[10px] uppercase font-bold text-muted-foreground">Confidence Ratio</div>
                          {isOpenEvent ? (
                            <div className="text-xs font-semibold mt-0.5 text-muted-foreground">N/A</div>
                          ) : (
                            <div className="mt-1 w-full">
                              <div className="flex items-center justify-between text-xs font-semibold font-mono mb-1">
                                <span>{(confidence * 100).toFixed(0)}%</span>
                                <span className={log.rejected ? "text-rose-400" : confidence > 0.75 ? "text-emerald-400" : "text-amber-400"}>
                                  {log.rejected ? "Rejected" : confidence > 0.75 ? "Confident" : "Low"}
                                </span>
                              </div>
                              <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${confColor}`}
                                  style={{ width: `${Math.min(100, Math.max(0, confidence * 100))}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Metric: Tokens */}
                      <div className="glass rounded-xl p-3 flex items-start gap-2.5 border border-white/5 bg-white/5">
                        <Coins className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                        <div>
                          <div className="text-[10px] uppercase font-bold text-muted-foreground">Token Cost</div>
                          {isOpenEvent ? (
                            <div className="text-xs font-semibold mt-0.5 text-muted-foreground">N/A</div>
                          ) : (
                            <div className="mt-0.5 font-mono text-xs flex flex-col gap-0.5">
                              <div>In: <span className="font-semibold text-foreground">{log.tokens_in ?? 0}</span></div>
                              <div>Out: <span className="font-semibold text-foreground">{log.tokens_out ?? 0}</span></div>
                            </div>
                          )}
                        </div>
                      </div>

                    </div>

                    {/* Prompt Inspector Panel */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground font-semibold flex items-center gap-1.5">
                          <Terminal className="w-3.5 h-3.5 text-primary" /> Prompt Query inspector
                        </span>
                        {log.question && (
                          <button
                            onClick={() => handleCopy(log.question, `q-${uniqueId}`)}
                            className="text-[11px] text-muted-foreground hover:text-primary transition flex items-center gap-1"
                          >
                            {copiedId === `q-${uniqueId}` ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" /> Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" /> Copy prompt
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      <div className="font-mono text-xs p-4 rounded-xl bg-black/40 border border-white/5 overflow-x-auto whitespace-pre-wrap leading-relaxed select-all max-h-72 shadow-inner text-muted-foreground hover:text-foreground transition duration-150">
                        {log.question || <span className="italic text-muted-foreground/50">(No prompt content logged)</span>}
                      </div>
                    </div>

                    {/* Metadata Footer: Date, Conv ID */}
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between text-xs text-muted-foreground/75 font-mono pt-2 border-t border-white/5 gap-2">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 shrink-0" />
                        <span>Created: {new Date(log.created_at).toLocaleString()}</span>
                      </div>
                      {log.conversation_id && (
                        <div className="flex items-center gap-1.5">
                          <span>Thread ID:</span>
                          <span className="bg-black/20 px-1.5 py-0.5 rounded text-[11px] font-semibold text-foreground select-all break-all">
                            {log.conversation_id}
                          </span>
                          <button
                            onClick={() => handleCopy(log.conversation_id, `cid-${uniqueId}`)}
                            className="hover:text-primary transition shrink-0"
                            title="Copy Thread ID"
                          >
                            {copiedId === `cid-${uniqueId}` ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>
            );
          })}

          {filteredLogs.length === 0 && (
            <div className="glass-card rounded-2xl p-12 text-center text-muted-foreground border border-dashed border-border/60">
              <AlertCircle className="w-8 h-8 mx-auto mb-3 text-muted-foreground/60" />
              <div className="font-medium text-foreground">No events match search filters</div>
              <p className="text-xs mt-1 max-w-sm mx-auto">
                Try modifying your query text, shifting dates, or switching the filter selection category.
              </p>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="mt-4 px-4 py-2 text-xs rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition inline-flex items-center gap-1.5"
                >
                  <XCircle className="w-3.5 h-3.5" /> Reset all active filters
                </button>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
