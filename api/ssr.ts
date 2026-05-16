/* Vercel serverless SSR adapter.
   This file adapts the app's server entry to Vercel's Node serverless handler.
   It imports the `@tanstack/react-start/server-entry` module used by the project
   and forwards incoming requests as Fetch `Request` objects to its `fetch` handler.
*/
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getServerEntry() {
  // Prefer the locally built server entry (dist/server/index.js) when available
  try {
    const projectRoot = process.cwd();
    const handlerDir = __dirname;
    
    console.log('--- SSR Entry Search Start ---');
    console.log('CWD:', projectRoot);
    console.log('__dirname:', handlerDir);
    
    const candidates = [
      path.join(projectRoot, 'dist', 'server', 'server.js'),
      path.join(projectRoot, 'dist', 'server', 'index.js'),
      path.join(projectRoot, 'server', 'server.js'),
      path.join(projectRoot, 'server', 'index.js'),
      path.join(handlerDir, '..', 'dist', 'server', 'server.js'),
      path.join(handlerDir, '..', 'dist', 'server', 'index.js'),
      path.join(handlerDir, '..', 'server', 'server.js'),
      path.join(handlerDir, '..', 'server', 'index.js'),
      path.join(handlerDir, 'dist', 'server', 'server.js'),
      path.join(handlerDir, 'dist', 'server', 'index.js'),
    ];
    
    console.log('Candidate paths:', candidates);
    
    for (const local of candidates) {
      if (fs.existsSync(local)) {
        console.log('MATCH FOUND:', local);
        try {
          const m = await import(pathToFileURL(local).href);
          console.log('IMPORT SUCCESSFUL');
          return (m as any).default ?? m;
        } catch (e) {
          console.error('IMPORT FAILED:', local, e);
          throw e;
        }
      } else {
        console.log('Not found:', local);
      }
    }
    
    console.error('CRITICAL: No server entry bundle found. Listing /var/task contents:');
    try {
      const dir = fs.readdirSync(projectRoot);
      console.log('Root files:', dir);
      if (fs.existsSync(path.join(projectRoot, 'dist'))) {
        console.log('dist files:', fs.readdirSync(path.join(projectRoot, 'dist')));
      }
    } catch (e) {}

    throw new Error('Server entry bundle not found.');
  } catch (err) {
    console.error('Error during entry search:', err);
    throw err;
  }
}

function headersFromRequest(req: any) {
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
    console.log('api/ssr invoked', { url: req.url, method: req.method });
    const entry = await getServerEntry();
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const host = req.headers.host || process.env.VERCEL_URL || 'localhost';
    const url = `${proto}://${host}${req.url}`;

    const init: RequestInit = {
      method: req.method,
      headers: headersFromRequest(req),
      // body must be undefined for GET/HEAD per Fetch spec
      body: undefined,
    };

    // If there is a request body (POST/PUT/PATCH), read it into a Buffer
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
        }
        if (chunks.length > 0) {
          const buf = Buffer.concat(chunks);
          init.body = buf;
        }
      } catch (e) {
        console.warn('Failed to read request body for SSR proxy, proceeding without body', e);
      }
    }

    const request = new Request(url, init);
    let response;
    try {
      response = await entry.fetch(request, process.env, undefined);
    } catch (err) {
      console.error('entry.fetch failed', err);
      // Return a safe static fallback HTML so the site doesn't 500 for all routes.
      const fallback = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Service Unavailable</title></head><body style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0b1220;color:#fff"><div style="text-align:center"><h1>Service temporarily unavailable</h1><p>We're experiencing a server issue. Please try again later.</p></div></body></html>`;
      res.status(502).setHeader('content-type', 'text/html; charset=utf-8');
      res.send(fallback);
      return;
    }

    // Copy status and headers
    res.status(response.status);
    response.headers.forEach((value: string, key: string) => res.setHeader(key, value));

    // Pipe body
    const buf = await response.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err: any) {
    console.error('SSR handler error', err);
    res.status(500).send('Internal Server Error');
  }
}
