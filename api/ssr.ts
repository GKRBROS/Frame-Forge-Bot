// @ts-nocheck
/* Vercel serverless SSR adapter.
   This file adapts the app's server entry to Vercel's Node serverless handler.
*/
async function getServerEntry() {
  const distPath = '../dist/server/server.js';
  const srcPath = '../src/server';
  
  try {
    const m = await import(distPath);
    return m.default ?? m;
  } catch (e) {
    console.warn('Could not import from dist, falling back to src/server', e);
    const m = await import(srcPath);
    return m.default ?? m;
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
    const entry = await getServerEntry();
    const proto = Array.isArray(req.headers['x-forwarded-proto']) 
      ? req.headers['x-forwarded-proto'][0] 
      : req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host || process.env.VERCEL_URL || 'localhost';
    const url = new URL(req.url || '/', `${proto}://${host}`).toString();

    const init: RequestInit = {
      method: req.method,
      headers: headersFromRequest(req),
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined,
    };

    const request = new Request(url, init);
    let response;

    // TanStack Start's createStartHandler returns a function that can be called with a Request.
    // If it's an object with a fetch method (older versions or custom wrappers), use that.
    if (typeof entry === 'function') {
      response = await entry(request);
    } else if (entry && typeof entry.fetch === 'function') {
      response = await entry.fetch(request);
    } else {
      console.error('Invalid server entry type:', typeof entry);
      throw new Error('Server entry is neither a function nor an object with a fetch method.');
    }

    res.status(response.status);
    response.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() !== 'content-encoding') {
        res.setHeader(key, value);
      }
    });

    const buf = await response.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err: any) {
    console.error('SSR handler error:', err);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: err.message,
      stack: err.stack
    });
  }
}
