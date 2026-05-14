/* Vercel serverless SSR adapter.
   This file adapts the app's server entry to Vercel's Node serverless handler.
   It imports the `@tanstack/react-start/server-entry` module used by the project
   and forwards incoming requests as Fetch `Request` objects to its `fetch` handler.
*/
import type { VercelRequest, VercelResponse } from '@vercel/node';

async function getServerEntry() {
  const m = await import('@tanstack/react-start/server-entry');
  return (m as any).default ?? m;
}

function headersFromRequest(req: VercelRequest) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (Array.isArray(v)) {
      for (const vv of v) headers.append(k, vv);
    } else if (v !== undefined) {
      headers.set(k, String(v));
    }
  }
  return headers;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const entry = await getServerEntry();
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const host = req.headers.host || process.env.VERCEL_URL || 'localhost';
    const url = `${proto}://${host}${req.url}`;

    const init: RequestInit = {
      method: req.method,
      headers: headersFromRequest(req),
      // body must be undefined for GET/HEAD per Fetch spec
      body: req.method && req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined,
    };

    const request = new Request(url, init);
    const response = await entry.fetch(request, {}, undefined);

    // Copy status and headers
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    // Pipe body
    const buf = await response.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err: any) {
    console.error('SSR handler error', err);
    res.status(500).send('Internal Server Error');
  }
}
