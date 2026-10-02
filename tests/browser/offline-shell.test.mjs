import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const base = process.env.ROAMLY_TEST_BASE_URL;
for (const { mobile, signedIn } of [{ mobile: false }, { mobile: true }, { mobile: true, signedIn: true }]) test(`production offline cold opening, account-independent cache and persistent notes (${mobile ? 'mobile' : 'desktop'}, ${signedIn ? 'account' : 'guest'})`, { timeout: 60_000 }, async () => {
  assert.ok(base); assert.equal(process.env.ROAMLY_TEST_OFFLINE_REQUIRED, '1');
  const browser = await chromium.launch({ headless: true, ...(process.env.ROAMLY_TEST_BROWSER_CHANNEL ? { channel: process.env.ROAMLY_TEST_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 }, serviceWorkers: 'allow' });
  let offline = false; let configReads = 0;
  const user = { id: 'offline-owner', generation: 'offline-generation', name: 'Offline Owner', email: 'offline-owner@example.invalid' };
  let data = { maps: ['Roteiro offline'], currentMap: 'Roteiro offline', places: [{ id: 'offline-place', placeId: 'offline-id', destination: 'Roteiro offline', name: 'Lugar privado de teste', note: 'Nota privada inicial', category: 'Museu', address: '', hours: '', status: 'closed', statusLabel: '', photo: '', rating: '', distance: '—', x: 45, y: 45 }] };
  let revision = 0; const receipts = new Set();
  try {
    await context.route('https://**', (route) => route.abort()); // No Google/email requests.
    await context.route('**/api/**', async (route) => {
      if (offline) return route.abort();
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth/config') configReads++;
      let json = url.pathname === '/api/auth/session' ? { user: signedIn ? user : null } : url.pathname === '/api/auth/config' ? { clientId: '' } : url.pathname === '/api/auth/challenge' ? { token: 'offline-test-csrf' } : { apiKey: '' };
      if (url.pathname === '/api/sync') {
        if (route.request().method() === 'PUT') {
          const body = route.request().postDataJSON(); assert.equal(body.baseRevision, revision);
          data = { maps: body.maps, currentMap: body.currentMap, places: body.places }; revision++;
          body.mutationIds.forEach((id) => receipts.add(id));
          json = { ok: true, revision, acknowledgedIds: body.mutationIds };
        } else json = { userId: user.id + ':' + user.generation, data, revision, acknowledgedIds: url.searchParams.getAll('pending').filter((id) => receipts.has(id)) };
      }
      await route.fulfill({ json, headers: { 'Cache-Control': 'no-store' } });
    });
    await context.addInitScript(({ data, signedIn, user }) => {
      const prefix = signedIn ? `roamly-cache:user:${encodeURIComponent(user.id + ':' + user.generation)}:` : 'roamly-cache:guest:';
      if (localStorage.getItem(prefix + 'roamly-maps')) return;
      if (signedIn) localStorage.setItem('roamly-last-account', JSON.stringify(user));
      localStorage.setItem('roamly-language', 'pt');
      localStorage.setItem(prefix + 'roamly-maps', JSON.stringify(['Roteiro offline']));
      localStorage.setItem(prefix + 'roamly-current-map', 'Roteiro offline');
      localStorage.setItem(prefix + 'roamly-place-refs', JSON.stringify(data.places));
    }, { data, signedIn, user });
    let page = await context.newPage();
    const openList = async () => {
      if (mobile) await page.locator('.bottom-nav').getByRole('button', { name: 'Lista', exact: true }).click();
      await page.locator('.place-row:visible').first().waitFor();
    };
    await page.goto(base);
    await openList();
    await page.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Offline worker did not activate')), 10_000))]));
    const keys = await page.evaluate(async () => {
      const names = await caches.keys();
      return (await Promise.all(names.filter((name) => name.startsWith('easy-road-map-shell-')).map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat();
    });
    assert.ok(keys.includes('/offline'));
    assert.ok(keys.every((key) => key === '/offline' || key.startsWith('/_next/static/') || /^\/(easy-road-map[^/]*\.(png|svg)|apple-touch-icon\.png|manifest\.webmanifest)$/.test(key)));
    const shell = await page.evaluate(async () => {
      const name = (await caches.keys()).find((name) => name.startsWith('easy-road-map-shell-'));
      return (await (await caches.open(name)).match('/offline')).text();
    });
    assert.equal(shell.includes('Lugar privado de teste'), false); assert.equal(shell.includes('Nota privada inicial'), false);
    assert.equal(shell.includes(user.email), false);
    await page.close();
    offline = true;
    await context.setOffline(true);
    page = await context.newPage();
    await page.goto(base);
    await openList();
    assert.match(await page.locator('.place-row:visible').first().innerText(), /Lugar privado de teste/);
    assert.match(await page.locator('.row-copy em:visible').first().innerText(), /Horário não confirmado/);
    await page.locator('.place-row:visible').first().click();
    if (mobile) await page.locator('.bottom-nav').getByRole('button', { name: 'Mapa', exact: true }).click();
    await page.locator('.note-field input').fill('Editada em abertura offline');
    await page.locator('.note-field input').blur();
    if (signedIn) await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.includes('roamly-pending:')));
    await page.close();
    page = await context.newPage(); await page.goto(base);
    await openList();
    assert.match(await page.locator('.row-copy em:visible').first().innerText(), /Horário não confirmado/);
    await page.locator('.place-row:visible').first().click();
    if (mobile) await page.locator('.bottom-nav').getByRole('button', { name: 'Mapa', exact: true }).click();
    assert.equal(await page.locator('.note-field input').inputValue(), 'Editada em abertura offline');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    offline = false; const reads = configReads;
    await context.setOffline(false);
    await page.waitForFunction(() => navigator.onLine);
    // Config lost at cold start must recover without requiring a reload.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(configReads > reads);
    if (signedIn) { await page.locator('.sync-pill.synced').first().waitFor({ state: 'attached' }); assert.equal(data.places[0].note, 'Editada em abertura offline'); }
    await page.reload();
    await openList();
  } finally { await context.close(); await browser.close(); }
});
