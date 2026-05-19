/* Vercel serverless SSR adapter.
   This file adapts the app's server entry to Vercel's Node serverless handler.
   It imports the `@tanstack/react-start/server-entry` module used by the project
   and forwards incoming requests as Fetch `Request` objects to its `fetch` handler.

   KEY FIX: When Vercel rewrites every path to /api/ssr, the req.url inside this
   function becomes "/api/ssr?..." instead of the original path (e.g. "/", "/app", "/login").
   We restore the original URL using the `x-original-url` header injected by vercel.json.
*/
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _serverEntry: any;

async function getServerEntry() {
  if (_serverEntry) return _serverEntry;

  const projectRoot = process.cwd();
  const handlerDir = __dirname;

  const candidates = [
    path.join(projectRoot, 'dist', 'server', 'server.js'),
    path.join(projectRoot, 'dist', 'server', 'index.js'),
    path.join(handlerDir, '..', 'dist', 'server', 'server.js'),
    path.join(handlerDir, '..', 'dist', 'server', 'index.js'),
  ];

  for (const local of candidates) {
    if (fs.existsSync(local)) {
      console.log('[ssr] Loading server entry:', local);
      try {
        const m = await import(pathToFileURL(local).href);
        _serverEntry = (m as any).default ?? m;
        return _serverEntry;
      } catch (e) {
        console.error('[ssr] Failed to import server entry:', local, e);
        throw e;
      }
    }
  }

  // Diagnostics for deployment debugging
  console.error('[ssr] CRITICAL: No server entry bundle found. Diagnostics:');
  try {
    console.log('[ssr] CWD files:', fs.readdirSync(projectRoot));
    const distPath = path.join(projectRoot, 'dist');
    if (fs.existsSync(distPath)) {
      console.log('[ssr] dist files:', fs.readdirSync(distPath));
      const serverPath = path.join(distPath, 'server');
      if (fs.existsSync(serverPath)) {
        console.log('[ssr] dist/server files:', fs.readdirSync(serverPath));
      }
    }
  } catch (_) {}

  throw new Error('Server entry bundle not found. Make sure the project was built before deploying.');
}

function headersFromRequest(req: any): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (Array.isArray(v)) {
      for (const vv of v as any) headers.append(k as string, String(vv));
    } else if (v !== undefined) {
      headers.set(k as string, String(v));
    }
  }
  return headers;
}

export default async function handler(req: any, res: any) {
  try {
    const entry = await getServerEntry();

    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const host = req.headers['x-forwarded-host'] as string
      || req.headers.host as string
      || process.env.VERCEL_URL
      || 'localhost';

    // Recover the original requested path (Vercel rewrites req.url to /api/ssr).
    // vercel.json injects x-original-url as "/$1" (the matched capture group).
    const originalPath = (req.headers['x-original-url'] as string | undefined)?.trim() || '/';
    const originalQuery = (() => {
      // req.url may contain query string even after rewrite, e.g. /api/ssr?foo=bar
      try {
        const u = new URL(req.url, 'http://localhost');
        return u.search || '';
      } catch {
        return '';
      }
    })();

    const url = `${proto}://${host}${originalPath}${originalQuery}`;
    console.log('[ssr] handler', { method: req.method, url, originalPath });

    const init: RequestInit = {
      method: req.method,
      headers: headersFromRequest(req),
      body: undefined,
    };

    // Read body for non-GET/HEAD methods
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
        }
        if (chunks.length > 0) {
          init.body = Buffer.concat(chunks);
        }
      } catch (e) {
        console.warn('[ssr] Failed to read request body, proceeding without body', e);
      }
    }

    const request = new Request(url, init);

    let response: Response;
    try {
      response = await entry.fetch(request, process.env, undefined);
    } catch (err) {
      console.error('[ssr] entry.fetch threw:', err);
      const fallback = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Service Unavailable</title></head><body style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0b1220;color:#fff"><div style="text-align:center"><h1>Service temporarily unavailable</h1><p>We're experiencing a server issue. Please try again in a moment.</p></div></body></html>`;
      res.status(502).setHeader('content-type', 'text/html; charset=utf-8');
      res.send(fallback);
      return;
    }

    res.status(response.status);
    response.headers.forEach((value: string, key: string) => {
      // Skip transfer-encoding which causes issues with Vercel's response piping
      if (key.toLowerCase() !== 'transfer-encoding') {
        res.setHeader(key, value);
      }
    });

    const buf = await response.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err: any) {
    console.error('[ssr] Handler error:', err);
    res.status(500).send('Internal Server Error');
  }
}
