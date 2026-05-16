const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const packageRoot = path.join(projectRoot, 'node_modules', '@tanstack', 'start-server-core');
const packageJsonPath = path.join(packageRoot, 'package.json');
const distEsmDir = path.join(packageRoot, 'dist', 'esm');

function writeFileIfChanged(filePath, content) {
  if (fs.existsSync(filePath)) {
    const current = fs.readFileSync(filePath, 'utf8');
    if (current === content) return;
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  fs.writeFileSync(filePath, content);
}

function main() {
  console.log('[patch-tanstack-start-server-core] starting patch...');
  if (!fs.existsSync(packageJsonPath)) {
    console.warn('[patch-tanstack-start-server-core] package not found at:', packageJsonPath);
    // Try alternative path (if node_modules is structured differently)
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  console.log('[patch-tanstack-start-server-core] current imports:', packageJson.imports);
  
  packageJson.imports = {
    ...(packageJson.imports || {}),
    '#tanstack-router-entry': './dist/esm/tanstack-router-entry.js',
    '#tanstack-start-entry': './dist/esm/tanstack-start-entry.js',
    '#tanstack-start-plugin-adapters': './dist/esm/tanstack-start-plugin-adapters.js',
  };
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log('[patch-tanstack-start-server-core] updated package.json imports');

  // Find the actual filenames during build time to avoid readdir at runtime
  const projectRootForBuild = process.cwd();
  const assetsDirForBuild = path.join(projectRootForBuild, 'dist', 'server', 'assets');
  const assetMap = {};
  
  if (fs.existsSync(assetsDirForBuild)) {
    const files = fs.readdirSync(assetsDirForBuild);
    const prefixes = [
      { key: 'router', prefix: 'router-' },
      { key: 'start', prefix: 'start-' },
      { key: 'pluginAdapters', prefix: '__23tanstack-start-plugin-adapters-' },
      { key: 'manifest', prefixes: ['_tanstack-start-manifest_v-', 'tanstack-start-manifest-'] },
    ];
    
    for (const p of prefixes) {
      if (p.prefixes) {
        for (const pref of p.prefixes) {
          const match = files.find(f => f.startsWith(pref) && f.endsWith('.js'));
          if (match) {
            assetMap[p.key] = match;
            break;
          }
        }
      } else {
        const match = files.find(f => f.startsWith(p.prefix) && f.endsWith('.js'));
        if (match) {
          assetMap[p.key] = match;
        }
      }
    }
  }
  console.log('[patch-tanstack-start-server-core] detected assets:', assetMap);

  const loaderSource = `import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const assetMap = ${JSON.stringify(assetMap)};

function findFile(key) {
  const prefix = assetMap[key];
  if (!prefix) {
    throw new Error(\`TanStack Start asset key "\${key}" not found in build-time map: \${JSON.stringify(assetMap)}\`);
  }

  const packageDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(packageDir, '../../../../../'),
    process.cwd(),
    path.resolve('/var/task'),
  ];

  for (const root of candidates) {
    const assetsDir = path.resolve(root, 'dist', 'server', 'assets');
    const filePath = path.join(assetsDir, prefix);
    if (fs.existsSync(filePath)) {
      return pathToFileURL(filePath).href;
    }
  }
  
  throw new Error(\`TanStack Start asset "\${prefix}" (key: \${key}) not found in candidates: \${candidates.join(', ')}\`);
}

async function loadModule(key) {
  return import(findFile(key));
}

export async function loadRouterEntry() {
  return await loadModule('router');
}

export async function loadStartEntry() {
  return await loadModule('start');
}

export async function loadPluginAdapters() {
  return await loadModule('pluginAdapters');
}
`;

  writeFileIfChanged(path.join(distEsmDir, 'tanstack-entry-loader.js'), loaderSource);

  const routerShim = `import { loadRouterEntry } from './tanstack-entry-loader.js';
const mod = await loadRouterEntry();
export const getRouter = () => mod.m.getRouter();
export default mod;
`;
  const startShim = `import { loadStartEntry } from './tanstack-entry-loader.js';
const mod = await loadStartEntry();
export const startInstance = mod.startInstance;
export default mod;
`;
  const pluginShim = `import { loadPluginAdapters } from './tanstack-entry-loader.js';
const mod = await loadPluginAdapters();
export const hasPluginAdapters = mod.hasPluginAdapters;
export const pluginSerializationAdapters = mod.pluginSerializationAdapters;
export default mod;
`;

  const startManifestShim = `import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const assetMap = ${JSON.stringify(assetMap)};

function findFile(key) {
  const prefix = assetMap[key];
  if (!prefix) {
    throw new Error(\`TanStack Start manifest asset key "\${key}" not found in build-time map\`);
  }

  const packageDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(packageDir, '../../../../../'),
    process.cwd(),
    path.resolve('/var/task'),
  ];

  for (const root of candidates) {
    const assetsDir = path.resolve(root, 'dist', 'server', 'assets');
    const filePath = path.join(assetsDir, prefix);
    if (fs.existsSync(filePath)) {
      return pathToFileURL(filePath).href;
    }
  }
  throw new Error(\`TanStack Start manifest asset "\${prefix}" not found in candidates: \${candidates.join(', ')}\`);
}

const fileUrl = findFile('manifest');
const mod = await import(fileUrl);
export const tsrStartManifest = mod.tsrStartManifest;
export default mod;
`;

  const injectedHeadScriptsShim = `export const injectedHeadScripts = undefined;
export default { injectedHeadScripts };
`;

  writeFileIfChanged(path.join(distEsmDir, 'tanstack-router-entry.js'), routerShim);
  writeFileIfChanged(path.join(distEsmDir, 'tanstack-start-entry.js'), startShim);
  writeFileIfChanged(path.join(distEsmDir, 'tanstack-start-plugin-adapters.js'), pluginShim);
  writeFileIfChanged(path.join(distEsmDir, 'tanstack-start-manifest.js'), startManifestShim);
  writeFileIfChanged(path.join(distEsmDir, 'tanstack-start-injected-head-scripts.js'), injectedHeadScriptsShim);

  const routerManifestPath = path.join(distEsmDir, 'router-manifest.js');
  if (fs.existsSync(routerManifestPath)) {
    let routerManifest = fs.readFileSync(routerManifestPath, 'utf8');
    routerManifest = routerManifest
      .replace(/import\("tanstack-start-manifest:v"\)/g, 'import("./tanstack-start-manifest.js")')
      .replace(/import\("tanstack-start-injected-head-scripts:v"\)/g, 'import("./tanstack-start-injected-head-scripts.js")');
    fs.writeFileSync(routerManifestPath, routerManifest);
    console.log('[patch-tanstack-start-server-core] patched router-manifest.js');
  }

  console.log('[patch-tanstack-start-server-core] patched', packageJsonPath);
}

main();
