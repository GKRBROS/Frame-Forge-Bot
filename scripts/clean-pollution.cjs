const fs = require('fs');
const path = require('path');

const targetDir = path.resolve(process.cwd(), 'node_modules/@tanstack/start-server-core/dist/esm');
const packageJsonPath = path.resolve(process.cwd(), 'node_modules/@tanstack/start-server-core/package.json');

console.log('[clean-pollution] target directory:', targetDir);

if (fs.existsSync(targetDir)) {
  const files = fs.readdirSync(targetDir);
  const pollutedFiles = files.filter(f => f.startsWith('tanstack-') && f.endsWith('.js'));
  
  for (const file of pollutedFiles) {
    const filePath = path.join(targetDir, file);
    console.log('[clean-pollution] removing:', filePath);
    fs.unlinkSync(filePath);
  }
} else {
  console.log('[clean-pollution] target directory not found, skipping file cleanup');
}

if (fs.existsSync(packageJsonPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (pkg.imports) {
      let changed = false;
      const keysToRemove = [
        '#tanstack-router-entry',
        '#tanstack-start-entry',
        '#tanstack-start-plugin-adapters'
      ];
      
      for (const key of keysToRemove) {
        if (pkg.imports[key]) {
          console.log('[clean-pollution] removing import:', key);
          delete pkg.imports[key];
          changed = true;
        }
      }
      
      if (changed) {
        fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
        console.log('[clean-pollution] updated package.json');
      }
    }
  } catch (err) {
    console.error('[clean-pollution] error updating package.json:', err);
  }
}

// Also try to restore router-manifest.js if it was patched
const manifestPath = path.join(targetDir, 'router-manifest.js');
if (fs.existsSync(manifestPath)) {
  let content = fs.readFileSync(manifestPath, 'utf8');
  if (content.includes('./tanstack-start-manifest.js')) {
    console.log('[clean-pollution] restoring router-manifest.js');
    content = content.replace(/\.\/tanstack-start-manifest\.js/g, 'tanstack-start-manifest:v');
    content = content.replace(/\.\/tanstack-start-injected-head-scripts\.js/g, 'tanstack-start-injected-head-scripts:v');
    fs.writeFileSync(manifestPath, content);
  }
}

console.log('[clean-pollution] finished');
