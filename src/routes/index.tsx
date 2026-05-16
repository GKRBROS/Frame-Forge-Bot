import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth } from "@/hooks/useAuth";
import { askPublic, listConversations, getMessages, createConversation, deleteConversation, extractPublicAttachment } from "@/lib/rag.functions";
import { Sparkles, Send, Shield, Loader2, FileText, BookOpen, Paperclip, X, ChevronDown, Type, Image as ImageIcon, LayoutDashboard } from "lucide-react";
import { Mermaid } from "@/components/Mermaid";
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
  imageUrl?: string;
  rejected?: boolean;
  attachments?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    preview?: string;
  }[];
};

type PendingAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  preview?: string;
  file: File;
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
  const [mode, setMode] = useState<'text'|'diagram'|'image'>('text');
  const [showCitations, setShowCitations] = useState(false);
  const [showLevelMenu, setShowLevelMenu] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function readFileAsDataUrl(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read attachment"));
      reader.readAsDataURL(file);
    });
  }

  async function send(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    const pendingAttachments = attachments;
    setInput("");
    setMessages((m) => [
      ...m,
      {
        role: "user",
        content: question,
        attachments: pendingAttachments.map((a) => ({
          id: a.id,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          preview: a.preview,
        })),
      },
    ]);
    setLoading(true);
    try {
      const extracted = await Promise.all(
        pendingAttachments.map(async (a) => {
          const base64 = await readFileAsDataUrl(a.file);
          const r = await extractPublicAttachment({ data: { name: a.name, mimeType: a.mimeType || a.file.type || "application/octet-stream", base64 } });
          return r;
        }),
      );
        const extractedWithContent = (extracted ?? []).filter((e) => (e?.content ?? "").trim().length > 0);
        // Surface any extraction errors to the user
        for (const e of (extracted ?? [])) {
          if ((!e?.content || e.content.trim().length === 0) && e?.error) {
            setMessages((m) => [
              ...m,
              { role: "assistant", content: `⚠️ Attachment "${e.name}" extraction failed: ${e.error}`, rejected: true },
            ]);
          }
        }
        const r = await ask({ data: { question, level, mode, attachmentContext: extractedWithContent.map((a) => ({ name: a.name, content: a.content })) } });
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: r.content,
          citations: r.citations,
          confidence: r.confidence,
          imageUrl: r.imageUrl,
          rejected: r.rejected,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : "Something went wrong"}`, rejected: true },
      ]);
    } finally {
      setAttachments([]);
      setLoading(false);
    }
  }

  const empty = messages.length === 0;

  // When a conversation is selected, load its messages into the UI
  useEffect(() => {
    if (msgsQuery.data) {
      const ms = Array.isArray(msgsQuery.data) ? msgsQuery.data : (msgsQuery.data as any).messages ?? [];
      setMessages(ms.map((m: any) => ({ role: m.role, content: m.content, citations: m.citations, confidence: m.confidence, rejected: m.rejected, imageUrl: m.image_url })));
    }
  }, [msgsQuery.data]);

  // Keep exactly one persistent conversation per user.
  useEffect(() => {
    (async () => {
      if (!user) return;
      const latest = convs.data?.[0];
      if (!activeConv && latest?.id) {
        setActiveConv(latest.id);
        return;
      }
      if (!activeConv && (!convs.data || convs.data.length === 0)) {
        try {
          const c = await createConv({ data: { title: 'Chat' } });
          if (c?.id) {
            setActiveConv(c.id);
            setMessages([]);
            convs.refetch?.();
          }
        } catch (err) {
          console.error('failed to create persistent conversation', err);
        }
      }
    })();
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

      {/* Single-page chat workspace */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
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
              <div className="flex items-center gap-1.5 relative">
                {/* Mode Selector */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowModeMenu(!showModeMenu)}
                    onBlur={() => setTimeout(() => setShowModeMenu(false), 200)}
                    className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl glass text-[11px] font-medium transition hover:border-primary/50"
                  >
                    {mode === 'text' ? <Type className="w-3.5 h-3.5" /> : mode === 'diagram' ? <LayoutDashboard className="w-3.5 h-3.5" /> : <ImageIcon className="w-3.5 h-3.5" />}
                    <span className="capitalize">{mode === 'text' ? 'Text' : mode === 'diagram' ? 'Diagram' : 'Image'}</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${showModeMenu ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {showModeMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                        className="absolute bottom-full left-0 mb-2 w-32 glass rounded-xl border border-white/10 p-1 shadow-2xl z-[60]"
                      >
                        {[
                          { id: 'text', label: 'Text Mode', icon: Type },
                          { id: 'diagram', label: 'Diagrams', icon: LayoutDashboard },
                          { id: 'image', label: 'Image Gen', icon: ImageIcon },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => { setMode(item.id as any); setShowModeMenu(false); }}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] transition ${mode === item.id ? 'bg-primary text-primary-foreground' : 'hover:bg-white/10'}`}
                          >
                            <item.icon className="w-3.5 h-3.5" />
                            {item.label}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Level Selector */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowLevelMenu(!showLevelMenu)}
                    onBlur={() => setTimeout(() => setShowLevelMenu(false), 200)}
                    className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl glass text-[11px] font-medium transition hover:border-primary/50"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span className="capitalize">{level}</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${showLevelMenu ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {showLevelMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                        className="absolute bottom-full right-0 mb-2 w-32 glass rounded-xl border border-white/10 p-1 shadow-2xl z-[60]"
                      >
                        {['beginner', 'intermediate', 'advanced'].map((l) => (
                          <button
                            key={l}
                            type="button"
                            onClick={() => { setLevel(l as any); setShowLevelMenu(false); }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-[11px] capitalize transition ${level === l ? 'bg-primary text-primary-foreground' : 'hover:bg-white/10'}`}
                          >
                            {l}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept="image/*,.pdf,.docx,.txt,.md,.csv,.json,.html,.htm"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.currentTarget.value = "";
                  if (files.length === 0) return;
                  setAttachments((prev) => [
                    ...prev,
                    ...files.map((file) => ({
                      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                      name: file.name,
                      mimeType: file.type || "application/octet-stream",
                      size: file.size,
                      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
                      file,
                    })),
                  ]);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-11 h-11 rounded-xl glass grid place-items-center glow-hover"
                title="Attach files or images"
              >
                <Paperclip className="w-4 h-4" />
              </button>
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
          {attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center gap-2 px-3 py-2 rounded-full glass text-xs">
                  <FileText className="w-3.5 h-3.5 text-primary" />
                  <span className="max-w-44 truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    className="text-muted-foreground hover:text-destructive"
                    title="Remove attachment"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-center gap-4 mt-3">
            <button
              type="button"
              onClick={async () => {
                if (!activeConv) return;
                if (!confirm('Clear this chat? This will delete the conversation and start a new one.')) return;
                try {
                  await deleteConv({ data: { id: activeConv } });
                  const nw = await createConv({ data: { title: 'Chat' } });
                  if (nw?.id) {
                    setActiveConv(nw.id);
                    setMessages([]);
                    convs.refetch?.();
                  }
                } catch (err) {
                  console.error('clear failed', err);
                }
              }}
              className="text-xs text-muted-foreground hover:text-destructive"
            >Clear chat</button>
          </div>
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
            <div className="space-y-3">
              <div className="whitespace-pre-wrap leading-relaxed text-[15px]">{msg.content}</div>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {msg.attachments.map((attachment) => (
                    <div key={attachment.id} className="flex items-center gap-2 rounded-full bg-black/10 px-3 py-2 text-xs backdrop-blur-sm">
                      {attachment.preview ? (
                        <img src={attachment.preview} alt={attachment.name} className="h-7 w-7 rounded object-cover" />
                      ) : (
                        <FileText className="w-3.5 h-3.5" />
                      )}
                      <span className="max-w-44 truncate">{attachment.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                  code: ({ node, className, children, ...props }) => {
                    const match = /language-(\w+)/.exec(className || '');
                    const isMermaid = match && match[1] === 'mermaid';
                    if (isMermaid) {
                      return <Mermaid chart={String(children).replace(/\n$/, '')} />;
                    }
                    return <code className="rounded bg-black/20 px-1 py-0.5 text-[0.92em]" {...props}>{children}</code>;
                  },
                  blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground">{children}</blockquote>,
                }}
              >
                {msg.content}
              </ReactMarkdown>
              {msg.imageUrl && (
                <div className="mt-4 rounded-xl overflow-hidden border border-white/10 shadow-lg">
                  <img src={msg.imageUrl} alt="Generated result" className="w-full h-auto object-cover max-h-[500px]" />
                </div>
              )}
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
