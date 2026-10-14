'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'vendor');
fs.mkdirSync(vendor, { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'taglib-entry.mjs')], outfile: path.join(vendor, 'taglib.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node16', minify: true,
  external: ['node:*', 'fs', 'path', 'url', 'crypto', 'module'],
  define: { 'import.meta.url': '__taglibModuleURL' },
  banner: { js: 'const __taglibModuleURL = require("url").pathToFileURL(__filename).href;' }
});
fs.copyFileSync(path.join(root, 'node_modules/taglib-wasm/dist/taglib-web.wasm'), path.join(vendor, 'taglib.wasm'));
fs.copyFileSync(path.join(root, 'node_modules/taglib-wasm/LICENSE'), path.join(vendor, 'TAGLIB-WASM-LICENSE.txt'));
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'metadata-entry.mjs')], outfile: path.join(vendor, 'metadata.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node16', minify: true,
  external: ['node:*', 'fs', 'path', 'url', 'crypto', 'module'],
});
// Include licenses for every bundled production dependency.
for (const entry of fs.readdirSync(path.join(root, 'node_modules'))) {
  if (entry.startsWith('.')) continue;
  const candidates = entry.startsWith('@') ? fs.readdirSync(path.join(root, 'node_modules', entry)).map(n => entry + '/' + n) : [entry];
  for (const name of candidates) {
    const dir = path.join(root, 'node_modules', name);
    for (const file of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license']) {
      if (fs.existsSync(path.join(dir, file))) { fs.copyFileSync(path.join(dir, file), path.join(vendor, name.replace('/', '-') + '-LICENSE.txt')); break; }
    }
  }
}
console.log('Built offline TagLib buffer backend for Node 16 / Eagle 4.');
