import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth } from "@/hooks/useAuth";
import { listConversations, getMessages, createConversation, deleteConversation } from "@/lib/rag.functions";
import { Sparkles, Send, Shield, Loader2, FileText, BookOpen } from "lucide-react";
import { askPublic } from "@/lib/rag.functions";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "KnowledgeScope AI — Ask your knowledge base" },
      { name: "description", content: "Ask questions and get answers grounded only in the curated knowledge base — never hallucinated, always cited." },
    ],
  }),
  component: ChatHome,
});

type Citation = { n: number; document_title: string; excerpt: string };
type Msg = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  confidence?: number;
  rejected?: boolean;
};

const SUGGESTIONS = [
  "What topics can you help with?",
  "Summarize the latest document",
  "Give me the key points",
  "What does the policy say about…",
];

function ChatHome() {
  const ask = useServerFn(askPublic);
  const { user } = useAuth();
  const listConv = useServerFn(listConversations);
  const createConv = useServerFn(createConversation);
  const deleteConv = useServerFn(deleteConversation);
  const getMsg = useServerFn(getMessages);
  const convs = useQuery({ queryKey: ["public-convs"], queryFn: () => listConv(), enabled: !!user });
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const msgsQuery = useQuery({ queryKey: ["public-msgs", activeConv], queryFn: () => getMsg({ data: { conversationId: activeConv! } }), enabled: !!activeConv });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [level, setLevel] = useState<'beginner'|'intermediate'|'advanced'>('beginner');
  const [showCitations, setShowCitations] = useState(false);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: question }]);
    setLoading(true);
    try {
      const r = await ask({ data: { question, level } });
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: r.content,
          citations: r.citations,
          confidence: r.confidence,
          rejected: r.rejected,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : "Something went wrong"}`, rejected: true },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const empty = messages.length === 0;

  // When a conversation is selected, load its messages into the UI
  useEffect(() => {
    if (msgsQuery.data) {
      const ms = Array.isArray(msgsQuery.data) ? msgsQuery.data : (msgsQuery.data as any).messages ?? [];
      setMessages(ms.map((m: any) => ({ role: m.role, content: m.content, citations: m.citations, confidence: m.confidence, rejected: m.rejected })));
    }
  }, [msgsQuery.data]);

  // Open the latest conversation automatically so the user lands on recent work.
  useEffect(() => {
    const latestConversation = convs.data?.[0]?.id;
    if (!activeConv && latestConversation) {
      setActiveConv(latestConversation);
    }
  }, [convs.data, activeConv]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav */}
      <motion.nav
        initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}
        className="glass sticky top-0 z-50 px-6 py-3 flex items-center justify-between"
      >
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold">
          <motion.div whileHover={{ rotate: 15, scale: 1.1 }} className="w-8 h-8 rounded-xl bg-hero-gradient grid place-items-center glow">
            <Sparkles className="w-4 h-4 text-primary-foreground" />
          </motion.div>
          <span className="text-gradient">KnowledgeScope</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            to="/login"
            className="px-3 py-2 rounded-full glass text-xs font-medium hover:border-primary transition flex items-center gap-1.5"
          >
            <Shield className="w-3.5 h-3.5" /> Admin
          </Link>
        </div>
      </motion.nav>

      {/* Layout: conversations sidebar + main chat area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <aside className="w-72 border-r border-border p-3 hidden md:flex md:flex-col md:shrink-0 h-full">
          <div className="shrink-0 mb-3">
            <div className="text-xs text-muted-foreground mb-2">Conversations</div>
            <button
              onClick={async () => {
                try {
                  const c = await createConv({ data: { title: 'New chat' } });
                  if (c?.id) {
                    setActiveConv(c.id);
                    setMessages([]);
                    // refetch conversations
                    convs.refetch?.();
                  }
                } catch (e) {
                  console.error('Failed to create conversation', e);
                }
              }}
              className="w-full px-3 py-2 rounded-lg bg-hero-gradient text-primary-foreground text-sm font-medium glow-hover mb-2"
            >+ New chat</button>
          </div>
          <div className="space-y-2 flex-1">
            {(convs.data ?? []).map((c: any) => (
              <div key={c.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm ${activeConv === c.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-secondary/50'}`}>
                <div className="flex-1 flex items-center gap-2" onClick={() => setActiveConv(c.id)}>
                  <BookOpen className="w-4 h-4 text-muted-foreground" />
                  <span className="truncate">{c.title}</span>
                </div>
                <button
                  title="Delete conversation"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm('Delete this conversation? This cannot be undone.')) return;
                    try {
                      await deleteConv({ data: { id: c.id } });
                      convs.refetch?.();
                      // if we deleted the active conversation, open a new one
                      if (activeConv === c.id) {
                        const nw = await createConv({ data: { title: 'New chat' } });
                        if (nw?.id) {
                          setActiveConv(nw.id);
                          setMessages([]);
                        } else {
                          setActiveConv(null);
                          setMessages([]);
                        }
                      }
                    } catch (err) {
                      console.error('delete failed', err);
                    }
                  }}
                  className="ml-2 text-danger hover:opacity-80 p-1 rounded"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-trash"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            ))}
            {convs.data?.length === 0 && <div className="text-xs text-muted-foreground">No conversations yet.</div>}
          </div>
        </aside>

        <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
          {user && (
            <div className="md:hidden px-4 pt-3">
              <div className="text-xs text-muted-foreground mb-2">Previous chats</div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {(convs.data ?? []).map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveConv(c.id)}
                    className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap ${activeConv === c.id ? 'bg-primary/15 text-primary border border-primary/30' : 'glass'}`}
                  >
                    {c.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div ref={scrollRef} className="flex-1 overflow-y-auto w-full px-4 md:px-6 py-6 md:py-8">
          <div className="min-h-full flex flex-col justify-end">
          <AnimatePresence mode="wait">
            {empty ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="text-center py-16 w-full max-w-3xl mx-auto"
              >
                <motion.div
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-hero-gradient glow mb-6"
                >
                  <Sparkles className="w-9 h-9 text-primary-foreground" />
                </motion.div>
                <h1 className="text-4xl md:text-5xl font-display font-bold mb-3">
                  Ask the <span className="text-gradient">knowledge base</span>
                </h1>
                <p className="text-muted-foreground max-w-lg mx-auto mb-8">
                  Every answer comes only from curated documents — with citations, never invented.
                </p>
                <div className="grid sm:grid-cols-2 gap-2 max-w-xl mx-auto">
                  {SUGGESTIONS.map((s, i) => (
                    <motion.button
                      key={s}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + i * 0.06 }}
                      whileHover={{ y: -2 }}
                      onClick={() => send(s)}
                      className="text-left text-sm glass-card rounded-xl px-4 py-3 hover:border-primary transition"
                    >
                      <BookOpen className="w-4 h-4 text-primary inline mr-2" />
                      {s}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div key="msgs" className="space-y-5 w-full max-w-3xl mx-auto">
                {messages.map((m, i) => (
                  <MessageBubble key={i} msg={m} showCitations={showCitations} />
                ))}
                {loading && <TypingIndicator />}
              </motion.div>
            )}
          </AnimatePresence>
          </div>
          </div>
        </main>
      </div>

      {/* Composer */}
      <div className="shrink-0">
        <div className="max-w-3xl mx-auto px-4 md:px-6 pb-4 md:pb-6 pt-2 md:pt-3">
          <motion.form
            initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="glass-card rounded-2xl p-2 flex flex-col sm:flex-row sm:items-center gap-2 shadow-soft"
          >
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything from the knowledge base…"
              className="w-full sm:flex-1 bg-transparent outline-none px-3 sm:px-4 py-3 placeholder:text-muted-foreground"
              disabled={loading}
            />
            <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-2">
              <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setLevel('beginner')} className={`px-3 py-2 rounded-lg text-xs ${level==='beginner' ? 'bg-primary/15 text-primary' : 'glass'}`}>Beginner</button>
              <button type="button" onClick={() => setLevel('intermediate')} className={`px-3 py-2 rounded-lg text-xs ${level==='intermediate' ? 'bg-primary/15 text-primary' : 'glass'}`}>Intermediate</button>
              <button type="button" onClick={() => setLevel('advanced')} className={`px-3 py-2 rounded-lg text-xs ${level==='advanced' ? 'bg-primary/15 text-primary' : 'glass'}`}>Advanced</button>
              </div>
              <motion.button
                whileTap={{ scale: 0.92 }} whileHover={{ scale: 1.05 }}
                type="submit"
                disabled={loading || !input.trim()}
                className="w-11 h-11 rounded-xl bg-hero-gradient grid place-items-center text-primary-foreground glow-hover disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </motion.button>
            </div>
          </motion.form>
          <div className="flex items-center justify-center gap-4 mt-3">
            <label className="text-xs text-muted-foreground">Show citations</label>
            <input type="checkbox" checked={showCitations} onChange={(e) => setShowCitations(e.target.checked)} />
          </div>
          <p className="text-[11px] text-center text-muted-foreground mt-2">
            Strict knowledge mode · Answers cite sources · Won't fabricate
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, showCitations }: { msg: Msg; showCitations?: boolean }) {
  const isUser = msg.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[85%] ${isUser ? "" : "w-full"}`}>
        <div
          className={
            isUser
              ? "bg-hero-gradient text-primary-foreground rounded-2xl rounded-br-md px-4 py-3 shadow-soft"
              : "glass-card rounded-2xl rounded-bl-md px-5 py-4"
          }
        >
          {isUser ? (
            <div className="whitespace-pre-wrap leading-relaxed text-[15px]">{msg.content}</div>
          ) : (
            <div className="leading-relaxed text-[15px] space-y-3">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <h1 className="text-xl font-semibold mt-2 mb-1">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-lg font-semibold mt-2 mb-1">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-base font-semibold mt-2 mb-1">{children}</h3>,
                  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  em: ({ children }) => <em className="italic">{children}</em>,
                  code: ({ children }) => <code className="rounded bg-black/20 px-1 py-0.5 text-[0.92em]">{children}</code>,
                  blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground">{children}</blockquote>,
                }}
              >
                {msg.content}
              </ReactMarkdown>
            </div>
          )}
          {msg.rejected && !isUser && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-warning">
              <Shield className="w-3 h-3" /> Out of scope · No source matched
            </div>
          )}
        </div>
        {!isUser && showCitations && msg.citations && msg.citations.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
            className="mt-2 space-y-1.5"
          >
            {msg.citations.map((c) => (
              <div key={c.n} className="glass rounded-lg p-2.5 text-xs flex gap-2">
                <span className="shrink-0 w-5 h-5 rounded grid place-items-center bg-primary/15 text-primary font-semibold">
                  {c.n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 font-medium text-foreground truncate">
                    <FileText className="w-3 h-3" /> {c.document_title}
                  </div>
                  <div className="text-muted-foreground line-clamp-2 mt-0.5">{c.excerpt}</div>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function TypingIndicator() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
      <div className="glass-card rounded-2xl rounded-bl-md px-5 py-4 flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-2 h-2 rounded-full bg-primary animate-pulse-dot"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </motion.div>
  );
}
