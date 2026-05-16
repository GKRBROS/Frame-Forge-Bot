/* Vercel serverless SSR adapter for TanStack Start.
   This file adapts the app's server entry to Vercel's Node serverless handler.
*/
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getServerEntry() {
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
      }
    }
    
    throw new Error('Server entry bundle not found.');
  } catch (err) {
    console.error('Error during entry search:', err);
    throw err;
  }
}

export default async (request: Request, env: any) => {
  try {
    // Ensure environment variables from the env object are in process.env
    if (env && typeof env === 'object') {
      for (const [key, val] of Object.entries(env)) {
        if (typeof val === 'string' && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }

    const entry = await getServerEntry();
    
    // Nitro/TanStack Start fetch handler expects (request, env)
    return await entry.fetch(request, env);
  } catch (err: any) {
    console.error('SSR Handler Error:', err);
    return new Response(
      `Internal Server Error\n\n${err.message}\n\n${err.stack}`,
      { status: 500 }
    );
  }
};
