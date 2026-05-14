const fs = require('fs');
const path = require('path');

const distServerDir = path.join(__dirname, '..', 'dist', 'server');
const indexPath = path.join(distServerDir, 'index.js');
const serverPath = path.join(distServerDir, 'server.js');

try {
  if (fs.existsSync(indexPath)) {
    fs.copyFileSync(indexPath, serverPath);
    console.log('postbuild: copied index.js -> server.js');
  } else {
    console.warn('postbuild: index.js not found, skipping copy');
  }
} catch (err) {
  console.error('postbuild: error ensuring server.js', err);
  process.exitCode = 1;
}
