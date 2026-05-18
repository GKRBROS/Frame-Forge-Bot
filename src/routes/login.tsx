import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Shield, Loader2, ArrowLeft } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ensureAdminAccount } from "@/lib/rag.functions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { toast } from "react-toastify";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Admin sign-in — KnowledgeScope AI" }] }),
  component: AdminLogin,
});

function AdminLogin() {
  const nav = useNavigate();
  const ensure = useServerFn(ensureAdminAccount);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setLoading(true);

    try {
      // Ask the server to ensure the admin account exists (server validates against .env).
      await ensure({ data: { email: email.trim().toLowerCase(), password } });
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw error;
      toast.success("Successfully signed in!");
      nav({ to: "/app" });
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : "Sign-in failed";
      setErr(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative">
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition">
          <ArrowLeft className="w-4 h-4" /> Back to chat
        </Link>
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="glass-card rounded-3xl p-8 w-full max-w-md relative overflow-hidden"
      >
        <motion.div
          aria-hidden
          animate={{ rotate: 360 }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-hero-gradient opacity-20 blur-3xl"
        />

        <div className="relative">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="w-14 h-14 rounded-2xl bg-hero-gradient grid place-items-center glow mb-6"
          >
            <Shield className="w-6 h-6 text-primary-foreground" />
          </motion.div>

          <div className="flex items-center gap-2 mb-1 text-xs uppercase tracking-wider text-primary font-semibold">
            <Sparkles className="w-3 h-3" /> Restricted area
          </div>
          <h1 className="text-2xl font-display font-bold mb-1">Administrator sign-in</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Only the designated administrator can manage the knowledge base.
          </p>

          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Email</label>
              <input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@yourdomain.com"
                className="w-full px-4 py-3 rounded-xl bg-input border border-border focus:border-primary outline-none transition"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Password</label>
              <input
                type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl bg-input border border-border focus:border-primary outline-none transition"
              />
            </div>

            {err && (
              <motion.div
                initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
                className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2"
              >
                {err}
              </motion.div>
            )}

            <motion.button
              whileTap={{ scale: 0.97 }}
              disabled={loading}
              className="w-full py-3 rounded-xl bg-hero-gradient text-primary-foreground font-medium glow-hover disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              {loading ? "Signing in…" : "Enter admin console"}
            </motion.button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
