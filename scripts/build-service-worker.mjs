import { offlineBuildId } from './offline-build-id.mjs';
import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const client = path.resolve('dist/client');
const files = [];
async function walk(relative) {
  for (const entry of await readdir(path.join(client, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) await walk(name);
    else if (entry.isFile() && /\.(js|css|woff2?|ttf|png|svg)$/.test(name)) files.push('/' + name);
  }
}
await walk('_next/static');
for (const name of ['easy-road-map-icon.svg', 'easy-road-map-192.png', 'easy-road-map-512.png', 'apple-touch-icon.png', 'manifest.webmanifest']) {
  try { await access(path.join(client, name)); files.push('/' + name); } catch { /* Existing optional asset only. */ }
}
files.sort();
const template = await readFile('scripts/service-worker.template.js', 'utf8');
const assets = await Promise.all(files.map(async (file) => [file, await readFile(path.join(client, file))]));
const build = offlineBuildId(assets, await readFile('dist/server/index.js'), template);
await writeFile(path.join(client, 'service-worker.js'), template.replace('__BUILD_ID__', build).replace('__PUBLIC_ASSETS__', JSON.stringify(files)));
let headers = ''; try { headers = await readFile(path.join(client, '_headers'), 'utf8'); } catch { /* New file. */ }
await writeFile(path.join(client, '_headers'), headers + '\n/service-worker.js\n  Cache-Control: no-cache\n');
console.log(`Offline shell ${build}: ${files.length} public assets. No private data cached.`);
