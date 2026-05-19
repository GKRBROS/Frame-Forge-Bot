// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    ssr: {
      noExternal: true,
      // Externalize problematic CJS packages during dev only.
      // Cloudflare/Vercel production builds MUST bundle everything.
      ...(process.env.NODE_ENV === 'production' ? {} : {
        external: ["react", "react-dom", "use-sync-external-store", "react/jsx-runtime", "react/jsx-dev-runtime"]
      }),
    },
    optimizeDeps: {
      // Do NOT include @tanstack/react-start here — it has server-only code
      // (AsyncLocalStorage / node:async_hooks) that crashes when Vite tries to
      // pre-bundle it for the browser in dev mode.
      include: ["react", "react-dom", "use-sync-external-store"],
      exclude: ["@tanstack/react-start"],
    },
  },
});
