/* Vercel serverless SSR adapter.
   This file adapts the app's server entry to Vercel's Node serverless handler.
   It imports the `@tanstack/react-start/server-entry` module used by the project
   and forwards incoming requests as Fetch `Request` objects to its `fetch` handler.
*/
async function getServerEntry() {
  // In Vercel production, we want to import the built server bundle.
  // The build script generates this in dist/server/server.js.
  try {
    // @ts-ignore
    const m = await import('../dist/server/server.js');
    return m.default ?? m;
  } catch (e) {
    console.warn('Could not import from dist, falling back to src/server', e);
    // @ts-ignore
    const m = await import('../src/server');
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

    console.log('api/ssr request', { url, method: req.method });

    const init: RequestInit = {
      method: req.method,
      headers: headersFromRequest(req),
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined,
    } as any;

    const request = new Request(url, init);
    const response = await entry.fetch(request, {}, undefined);

    // Copy status and headers
    res.status(response.status);
    response.headers.forEach((value: string, key: string) => {
      // Avoid setting content-encoding if we are letting Vercel handle compression
      if (key.toLowerCase() !== 'content-encoding') {
        res.setHeader(key, value);
      }
    });

    // Pipe body
    const buf = await response.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err: any) {
    console.error('SSR handler error:', err);
    // Return more info in the response to help debug Internal Server Errors
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined 
    });
  }
}
