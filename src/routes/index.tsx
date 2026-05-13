import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
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
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
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
      const r = await ask({ data: { question } });
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
            to="/adm"
            className="px-3 py-2 rounded-full glass text-xs font-medium hover:border-primary transition flex items-center gap-1.5"
          >
            <Shield className="w-3.5 h-3.5" /> Admin
          </Link>
        </div>
      </motion.nav>

      {/* Chat area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
          <AnimatePresence mode="wait">
            {empty ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="text-center py-16"
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
              <motion.div key="msgs" className="space-y-5">
                {messages.map((m, i) => (
                  <MessageBubble key={i} msg={m} />
                ))}
                {loading && <TypingIndicator />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Composer */}
      <div className="sticky bottom-0">
        <div className="max-w-3xl mx-auto px-4 md:px-6 pb-6 pt-3">
          <motion.form
            initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="glass-card rounded-2xl p-2 flex items-center gap-2 shadow-soft"
          >
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything from the knowledge base…"
              className="flex-1 bg-transparent outline-none px-4 py-3 placeholder:text-muted-foreground"
              disabled={loading}
            />
            <motion.button
              whileTap={{ scale: 0.92 }} whileHover={{ scale: 1.05 }}
              type="submit"
              disabled={loading || !input.trim()}
              className="w-11 h-11 rounded-xl bg-hero-gradient grid place-items-center text-primary-foreground glow-hover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </motion.button>
          </motion.form>
          <p className="text-[11px] text-center text-muted-foreground mt-2">
            Strict knowledge mode · Answers cite sources · Won't fabricate
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
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
          <div className="whitespace-pre-wrap leading-relaxed text-[15px]">{msg.content}</div>
          {msg.rejected && !isUser && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-warning">
              <Shield className="w-3 h-3" /> Out of scope · No source matched
            </div>
          )}
        </div>
        {!isUser && msg.citations && msg.citations.length > 0 && (
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
