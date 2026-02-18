const fs = require('fs');
const path = require('path');

const clientDist = path.join(__dirname, '..', 'client', 'dist');
const publicDir = path.join(__dirname, '..', 'public');

if (!fs.existsSync(clientDist)) {
  console.warn('client/dist not found, skipping copy');
  process.exit(0);
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

copyRecursive(clientDist, publicDir);
console.log('Copied client/dist to public for Vercel');
