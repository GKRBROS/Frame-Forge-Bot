/* Vercel serverless SSR adapter.
   This file adapts the app's server entry to Vercel's Node serverless handler.
   It imports the `@tanstack/react-start/server-entry` module used by the project
   and forwards incoming requests as Fetch `Request` objects to its `fetch` handler.
*/
async function getServerEntry() {
  // Prefer the locally built server entry (dist/server/index.js) when available
  try {
    const path = require('path');
    const fs = require('fs');
    const { pathToFileURL } = require('url');
    const candidates = [
      path.join(process.cwd(), 'dist', 'server', 'server.js'),
      path.join(process.cwd(), 'dist', 'server', 'index.js'),
      path.join(process.cwd(), 'dist', 'server', 'index.cjs'),
    ];
    for (const local of candidates) {
      try {
        if (fs.existsSync(local)) {
          console.log('Using local server entry:', local);
          const m = await import(pathToFileURL(local).href);
          return (m as any).default ?? m;
        }
      } catch (e) {
        console.warn('Failed to import local server entry', local, e);
      }
    }
  } catch (err) {
    // ignore and fallback
  }

  const m = await import('@tanstack/react-start/server-entry');
  return (m as any).default ?? m;
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
      response = await entry.fetch(request, {}, undefined);
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
