import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, Shield, Database, Zap, Lock, FileSearch } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "KnowledgeScope AI — Strict-Knowledge AI for your documents" },
      { name: "description", content: "Upload your documents. Ask anything. Get answers grounded only in your knowledge — never hallucinated." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen">
      <nav className="glass sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold">
          <Sparkles className="w-6 h-6 text-primary" />
          <span className="text-gradient">KnowledgeScope AI</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/login" className="px-4 py-2 text-sm hover:text-primary transition">Log in</Link>
          <Link to="/signup" className="px-4 py-2 text-sm font-medium rounded-lg bg-hero-gradient text-primary-foreground glow-hover">
            Get started
          </Link>
        </div>
      </nav>

      <section className="max-w-6xl mx-auto px-6 pt-24 pb-32 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass text-xs mb-8">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          Strict knowledge mode · Zero hallucination
        </div>
        <h1 className="text-6xl md:text-7xl font-display font-bold leading-tight mb-6">
          Your knowledge.<br />
          <span className="text-gradient">Answered with citations.</span>
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          KnowledgeScope AI answers strictly from documents you upload. No outside data, no guessing — when it doesn't know, it tells you.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link to="/signup" className="px-7 py-3.5 rounded-xl bg-hero-gradient text-primary-foreground font-medium glow glow-hover">
            Start free
          </Link>
          <Link to="/login" className="px-7 py-3.5 rounded-xl glass font-medium hover:border-primary transition">
            Sign in
          </Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24 grid md:grid-cols-3 gap-6">
        {[
          { icon: Shield, title: "Hallucination-proof", desc: "Strict RAG enforcement. If it's not in your docs, the AI won't make it up." },
          { icon: FileSearch, title: "Cited answers", desc: "Every response includes inline citations and source previews." },
          { icon: Database, title: "Your knowledge base", desc: "Upload .txt, .md, .csv, .json. Paste long-form text. Re-index anytime." },
          { icon: Zap, title: "Hybrid retrieval", desc: "Full-text + trigram search with confidence scoring before the LLM ever sees it." },
          { icon: Lock, title: "Per-user isolation", desc: "Row-level security. Your documents stay yours." },
          { icon: Sparkles, title: "OpenRouter inside", desc: "Pick from DeepSeek, Qwen, Claude, and more. Switch models anytime." },
        ].map((f) => (
          <div key={f.title} className="glass-card rounded-2xl p-6 glow-hover">
            <f.icon className="w-7 h-7 text-primary mb-4" />
            <h3 className="font-display font-semibold mb-2">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </section>

      <section className="max-w-4xl mx-auto px-6 pb-32 text-center">
        <h2 className="text-4xl font-display font-bold mb-4">Pricing</h2>
        <p className="text-muted-foreground mb-12">Free during beta — bring your own OpenRouter usage.</p>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="glass-card rounded-2xl p-8 text-left">
            <div className="text-sm text-muted-foreground mb-2">Free</div>
            <div className="text-4xl font-display font-bold mb-4">$0</div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>· Unlimited documents</li>
              <li>· Strict knowledge mode</li>
              <li>· Citations & confidence scoring</li>
              <li>· Single workspace</li>
            </ul>
          </div>
          <div className="glass-card rounded-2xl p-8 text-left border-primary/40">
            <div className="text-sm text-primary mb-2">Team — coming soon</div>
            <div className="text-4xl font-display font-bold mb-4">Contact</div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>· Multiple workspaces</li>
              <li>· SSO + audit logs</li>
              <li>· Web scraping ingestion</li>
              <li>· Priority models</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} KnowledgeScope AI
      </footer>
    </div>
  );
}
