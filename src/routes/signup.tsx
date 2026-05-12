import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Sign up — KnowledgeScope AI" }] }),
  component: Signup,
});

function Signup() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { display_name: name }, emailRedirectTo: window.location.origin + "/app" },
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    nav({ to: "/app" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="glass-card rounded-2xl p-8 w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold mb-8">
          <Sparkles className="w-6 h-6 text-primary" />
          <span className="text-gradient">KnowledgeScope</span>
        </Link>
        <h1 className="text-2xl font-display font-bold mb-1">Create your workspace</h1>
        <p className="text-sm text-muted-foreground mb-6">First user becomes admin automatically.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <input required placeholder="Display name" value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-input border border-border focus:border-primary outline-none" />
          <input type="email" required placeholder="you@company.com" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-input border border-border focus:border-primary outline-none" />
          <input type="password" required minLength={6} placeholder="Password (6+ chars)" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-input border border-border focus:border-primary outline-none" />
          {err && <div className="text-sm text-destructive">{err}</div>}
          <button disabled={loading} className="w-full py-3 rounded-lg bg-hero-gradient text-primary-foreground font-medium glow-hover disabled:opacity-50">
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>
        <p className="text-sm text-muted-foreground mt-6 text-center">
          Already have one? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
