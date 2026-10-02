import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { offlineBuildId } from '../scripts/offline-build-id.mjs';

const template = await readFile(new URL('../scripts/service-worker.template.js', import.meta.url), 'utf8');
const origin = 'https://app.example.invalid';
function worker({ failAssets = false } = {}) {
  const handlers = {}; const entries = new Map(); const deleted = []; const requests = [];
  const cache = { async put(key, value) { entries.set(key, value); }, async match(key) { return entries.get(key); }, async addAll(values) { requests.push(...values); if (failAssets) throw new Error('Failed asset'); } };
  vm.runInNewContext(template.replace('__BUILD_ID__', 'new').replace('__PUBLIC_ASSETS__', JSON.stringify(['/_next/static/app.js', '/manifest.webmanifest'])), {
    self: { location: { origin }, addEventListener: (name, handler) => { handlers[name] = handler; } },
    caches: { async open() { return cache; }, async keys() { return ['unrelated', 'easy-road-map-shell-old', 'easy-road-map-shell-new']; }, async delete(name) { deleted.push(name); } },
    Request: class { constructor(url, options) { this.url = new URL(url, origin).href; Object.assign(this, options); } },
    URL, Response, fetch: async (request) => { requests.push(request); return { status: 200, redirected: false, url: origin + '/offline', headers: new Headers({ 'content-type': 'text/html' }) }; },
  });
  return { handlers, entries, deleted, requests };
}

test('offline cache identity includes worker-only changes and server shell', () => {
  const assets = [['/app.js', 'same']]; const build = offlineBuildId(assets, 'shell', template);
  assert.notEqual(build, offlineBuildId(assets, 'shell', template + '\n// changed'));
  assert.notEqual(build, offlineBuildId(assets, 'new shell', template));
  assert.notEqual(build, offlineBuildId([['/app.js', 'new']], 'shell', template));
});

test('offline worker never intercepts private APIs, invites, external media or RSC queries', () => {
  const { handlers } = worker();
  for (const [url, method, mode] of [['/api/sync', 'GET', 'cors'], ['/share/private', 'GET', 'navigate'], ['/_next/static/app.js?_rsc=private', 'GET', 'cors'], ['https://maps.example.invalid/photo', 'GET', 'cors'], ['/', 'POST', 'navigate'], ['/?private=token', 'GET', 'navigate']]) {
    let intercepted = false;
    handlers.fetch({ request: { url: new URL(url, origin).href, method, mode }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false, url);
  }
});

test('precache is anonymous and install failure never deletes the previous active cache', async () => {
  const good = worker(); let pending;
  good.handlers.install({ waitUntil(value) { pending = value; } }); await pending;
  assert.ok(good.entries.has('/offline'));
  assert.ok(good.requests.every((request) => request.credentials === 'omit'));
  const failed = worker({ failAssets: true });
  failed.handlers.install({ waitUntil(value) { pending = value; } });
  await assert.rejects(pending, /Failed asset/);
  assert.deepEqual(failed.deleted, ['easy-road-map-shell-new']);
});

test('activation removes only superseded app-shell caches without forcing old tabs', async () => {
  const { handlers, deleted } = worker(); let pending;
  handlers.activate({ waitUntil(value) { pending = value; } }); await pending;
  assert.deepEqual(deleted, ['easy-road-map-shell-old']);
  assert.equal(template.includes('self.skipWaiting('), false);
  assert.equal(template.includes('self.clients.claim('), false);
});
