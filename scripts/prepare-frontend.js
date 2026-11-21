const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const required = [
  'frontend-v2/index.html',
  'frontend-v2/package.json',
  'frontend-v2/styles/tokens.css',
  'frontend-v2/styles/app.css',
  'frontend-v2/core/app.js',
  'frontend-v2/core/api.js',
  'frontend/mobile/index.html',
  'frontend/mobile/app.js',
  'frontend/mobile/mobile.css'
];
for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error('[frontend] Required POSNIC Next / Samarina Companion asset is missing: ' + relative);
  }
}
console.log('[frontend] POSNIC Next renderer and untouched Samarina Companion assets are ready.');
