import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.ROAMLY_TEST_BASE_URL;
const owner = { id: 'browser-owner', generation: 'browser-generation', email: 'owner@example.invalid', name: 'Browser Owner' };
const identity = `${owner.id}:${owner.generation}`;
const place = {
  id: 'fixture-place', placeId: 'ChIJFixturePlace', destination: 'Roma', name: 'Museu de teste',
  category: 'Museu', address: 'Rua de teste, 1', hours: '09:00 – 18:00', status: 'open', statusLabel: 'Aberto agora',
  note: '', photo: '', x: 45, y: 45, rating: '4,5', lat: -27.59, lng: -48.55,
};
const itinerary = () => ({ maps: ['Roma'], currentMap: 'Roma', places: [{ ...place }] });
let browser;
before(async () => {
  assert.ok(baseUrl, 'Run with pnpm test:browser (or set ROAMLY_TEST_BASE_URL).');
  browser = await chromium.launch({ headless: true, ...(process.env.ROAMLY_TEST_BROWSER_CHANNEL ? { channel: process.env.ROAMLY_TEST_BROWSER_CHANNEL } : {}) });
});
after(async () => { await browser?.close(); });

async function run(t, options, action) {
  const context = await browser.newContext({ viewport: options.mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 }, serviceWorkers: 'block', ...(options.location ? { geolocation: { latitude: -27.59, longitude: -48.55 }, permissions: ['geolocation'] } : {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const state = { user: options.signedIn ? owner : null, data: options.data ?? itinerary(), revision: 0, receipts: new Set(), shares: [], requests: [], offline: false };
  await context.addInitScript((data) => {
    window.__testOnline = localStorage.getItem('test-offline') !== 'true';
    Object.defineProperty(navigator, 'onLine', { get: () => window.__testOnline });
    if (localStorage.getItem('roadmap-test-seeded')) return;
    localStorage.setItem('roadmap-test-seeded', 'true');
    localStorage.setItem('roamly-language', 'pt');
    localStorage.setItem('roamly-theme', 'light');
    const prefix = 'roamly-cache:guest:';
    localStorage.setItem(prefix + 'roamly-maps', JSON.stringify(data.maps));
    localStorage.setItem(prefix + 'roamly-current-map', data.currentMap);
    localStorage.setItem(prefix + 'roamly-place-refs', JSON.stringify(data.places));
  }, state.data);
  if (options.mapsReady) await context.addInitScript((data) => {
    window.__placesRequests = 0; window.__autocompleteCalls = 0;
    class FakeMap {
      constructor(_container, config) { this.center = config.center; this.zoom = config.zoom; }
      addListener() { return { remove() {} }; } getCenter() { return { toJSON: () => this.center }; }
      getZoom() { return this.zoom; } getHeading() { return 0; } getTilt() { return 0; }
      getBounds() { return undefined; } panTo(center) { this.center = center; } setZoom(zoom) { this.zoom = zoom; } setOptions() {} fitBounds() {}
    }
    class FakeMarker { constructor(value) { Object.assign(this, value); } addEventListener() {} removeEventListener() {} }
    class FakePlace {
      constructor({ id }) {
        const saved = data.places.find((place) => place.placeId === id) ?? data.places[0];
        this.id = id; this.displayName = saved.name; this.primaryType = 'museum'; this.formattedAddress = 'Endereço atualizado pelo Google'; this.location = { toJSON: () => ({ lat: saved.lat, lng: saved.lng }) };
        this.currentOpeningHours = { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] };
        this.photos = [{ getURI: () => 'https://photo.example.invalid/first.png', authorAttributions: [{ displayName: 'Autor sem link' }, { displayName: 'Outro autor', uri: 'https://example.invalid/author' }] }, { getURI: () => 'https://photo.example.invalid/second.png' }];
      }
      async fetchFields() { window.__placesRequests++; if (window.__testQuota) throw new Error('RESOURCE_EXHAUSTED: quota exceeded'); }
    }
    window.google = { maps: { Map: FakeMap, marker: { AdvancedMarkerElement: FakeMarker, PinElement: class { constructor(value) { Object.assign(this, value); } } }, places: { Place: FakePlace, AutocompleteSessionToken: class {}, AutocompleteSuggestion: { async fetchAutocompleteSuggestions() { window.__autocompleteCalls++; return { suggestions: [] }; } } }, event: { clearInstanceListeners() {} }, LatLngBounds: class { extend() {} }, async importLibrary() {} } };
  }, state.data);
  if (options.blockStorage) await context.addInitScript((mode) => {
    if (mode === 'getter') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    else Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  }, options.blockStorage);
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(baseUrl).origin) {
      if (url.origin === 'https://photo.example.invalid') return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCfcAAAAASUVORK5CYII=', 'base64') });
      if (url.origin === 'https://www.google.com' && url.pathname.startsWith('/maps/dir/')) return route.fulfill({ contentType: 'text/html', body: '<h1>Mock Google Maps route</h1>' });
      return route.abort(); // No live Google APIs, email, photos, analytics or charges.
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (state.offline) return route.abort();
    state.requests.push({ path: url.pathname, method: request.method(), headers: request.headers(), body: request.postDataJSON() });
    let payload;
    if (url.pathname === '/api/auth/config') payload = { clientId: '' };
    else if (url.pathname === '/api/google-config') payload = { apiKey: options.mapsReady ? 'fake-browser-test-key' : '' };
    else if (url.pathname === '/api/auth/session') payload = { user: state.user };
    else if (url.pathname === '/api/auth/challenge') payload = { token: 'browser-csrf' };
    else if (url.pathname === '/api/sync') {
      const acknowledgedIds = url.searchParams.getAll('pending').filter((id) => state.receipts.has(id));
      if (request.method() === 'DELETE') { state.user = null; state.data = { maps: [], currentMap: '', places: [] }; payload = { ok: true }; }
      else if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        if (body.baseRevision !== state.revision || body.mutationIds.some((id) => state.receipts.has(id))) return route.fulfill({ status: 412, json: { code: 'revision_conflict' } });
        state.data = { maps: body.maps, currentMap: body.currentMap, places: body.places };
        state.revision++; body.mutationIds.forEach((id) => state.receipts.add(id));
        payload = { ok: true, revision: state.revision, acknowledgedIds: body.mutationIds };
      } else payload = { userId: identity, data: state.data, revision: state.revision, acknowledgedIds };
    } else if (url.pathname === '/api/shares/import') payload = { ok: true };
    else if (url.pathname === '/api/shares') {
      if (request.method() === 'POST') {
        const email = request.postDataJSON().email;
        state.shares.push({ share_id: 'browser-share', invited_email: email, created_at: Date.now() });
        payload = { shareId: 'browser-share', email, created: true, emailSent: false, emailRateLimited: true };
      } else if (request.method() === 'DELETE') { state.shares = []; payload = { ok: true }; }
      else payload = url.searchParams.has('shareId') ? { map: { name: 'Roma', places: [{ ...place }] } } : { shares: state.shares };
    } else throw new Error('Unexpected API request: ' + request.url());
    await route.fulfill({ json: payload, headers: { 'Cache-Control': 'no-store' } });
  });
  try {
    await action(page, state);
    assert.deepEqual(errors, [], 'No browser runtime exceptions');
  } catch (error) {
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: `test-results/${t.name.replace(/[^a-z0-9]+/gi, '-')}.png`, fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

async function home(page) {
  await page.goto(baseUrl);
  await page.locator('h1').filter({ hasText: 'Seu roteiro em Roma' }).waitFor({ state: 'attached' });
}
const switchMap = (page) => page.getByRole('button', { name: 'Trocar mapa de viagem', exact: true }).click();
const selectPlace = (page) => page.locator('.desktop-list .place-row').filter({ hasText: place.name }).click();

test('create, deduplicate and delete destinations persist after reload', { timeout: 60_000 }, async (t) => run(t, {}, async (page) => {
  await home(page);
  await switchMap(page);
  await page.locator('#new-map').fill('Lisboa');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar mapa', exact: true }).click();
  await page.locator('h1').filter({ hasText: 'Seu roteiro em Lisboa' }).waitFor();
  await switchMap(page);
  await page.locator('#new-map').fill(' lisboa ');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar mapa', exact: true }).click();
  await switchMap(page);
  assert.equal(await page.locator('.map-option-row').count(), 2);
  await page.getByRole('button', { name: 'Excluir mapa Lisboa', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir mapa', exact: true }).click();
  await page.locator('h1').filter({ hasText: 'Seu roteiro em Roma' }).waitFor();
  await page.reload();
  await page.locator('h1').filter({ hasText: 'Seu roteiro em Roma' }).waitFor();
  await switchMap(page);
  assert.equal(await page.locator('.map-option-row').count(), 1);
}));

test('notes, pin color, detail dismissal and place removal survive reload', { timeout: 60_000 }, async (t) => run(t, {}, async (page) => {
  await home(page);
  await selectPlace(page);
  await page.getByLabel('NOTA PESSOAL', { exact: true }).fill('Comprar ingresso antecipado');
  await page.getByRole('button', { name: 'COR DO PIN: Azul', exact: true }).click();
  await page.reload();
  await page.locator('h1').filter({ hasText: 'Seu roteiro em Roma' }).waitFor();
  await selectPlace(page);
  assert.equal(await page.getByLabel('NOTA PESSOAL', { exact: true }).inputValue(), 'Comprar ingresso antecipado');
  assert.match(await page.getByRole('button', { name: 'COR DO PIN: Azul', exact: true }).getAttribute('class'), /active/);
  await page.getByRole('button', { name: 'Fechar detalhes', exact: true }).click();
  await page.locator('.place-card').waitFor({ state: 'detached' });
  await selectPlace(page);
  await page.getByRole('button', { name: 'Remover', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remover local', exact: true }).click();
  await page.locator('.desktop-list .place-row').waitFor({ state: 'detached' });
  await page.reload();
  await page.locator('.panel-empty').first().waitFor();
  assert.equal(await page.locator('.desktop-list .place-row').count(), 0);
}));

test('all four transportation choices navigate with the Google Place ID', { timeout: 60_000 }, async (t) => run(t, {}, async (page) => {
  for (const [label, mode] of [['A pé', 'walking'], ['Carro', 'driving'], ['Bicicleta', 'bicycling'], ['Transporte', 'transit']]) {
    await home(page);
    await selectPlace(page);
    await page.getByRole('button', { name: 'Ir com Maps', exact: true }).click();
    await page.getByRole('dialog', { name: 'Escolher meio de transporte' }).getByRole('button', { name: new RegExp('^' + label) }).click();
    await page.waitForURL('https://www.google.com/maps/dir/**');
    const url = new URL(page.url());
    assert.equal(url.searchParams.get('travelmode'), mode);
    assert.equal(url.searchParams.get('destination_place_id'), place.placeId);
    assert.equal(url.searchParams.get('dir_action'), 'navigate');
    assert.equal(url.searchParams.has('origin'), false);
  }
}));

test('mobile list, three languages and dark mode remain usable and persist', { timeout: 60_000 }, async (t) => run(t, { mobile: true }, async (page) => {
  await home(page);
  await page.locator('.bottom-nav').getByRole('button', { name: 'Lista', exact: true }).click();
  await page.locator('.map-area.mobile-list-view').waitFor();
  await page.locator('.mobile-list .place-row').waitFor();
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('en');
  await page.locator('.mobile-list h2').filter({ hasText: 'Your itinerary in Roma' }).waitFor();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('es');
  await page.locator('.mobile-list h2').filter({ hasText: 'Tu itinerario en Roma' }).waitFor();
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('pt');
  await page.getByRole('button', { name: 'Ativar modo noturno', exact: true }).click();
  await page.locator('html[data-theme="dark"]').waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Ativar modo claro', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('roamly-language')), 'pt');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal page overflow');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Lista', exact: true }).click();
  await page.locator('.mobile-list .place-row').waitFor();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/mobile-dark.png', fullPage: true });
}));

test('email-budget fallback keeps the manual invitation available and revocable', { timeout: 60_000 }, async (t) => run(t, { signedIn: true }, async (page, state) => {
  await home(page);
  await page.locator('.sync-pill.synced').waitFor();
  await switchMap(page);
  await page.getByRole('button', { name: 'Compartilhar mapa Roma', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Compartilhar mapa', exact: true });
  await dialog.locator('#share-email').fill('Friend@Example.Invalid');
  await dialog.getByRole('button', { name: 'Criar convite', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: 'limite temporário' }).waitFor();
  await dialog.getByRole('button', { name: 'Copiar link: friend@example.invalid', exact: true }).waitFor();
  assert.match(await dialog.getByRole('link', { name: 'Enviar manualmente por e-mail: friend@example.invalid' }).getAttribute('href'), /browser-share/);
  const created = state.requests.find((request) => request.path === '/api/shares' && request.method === 'POST');
  assert.equal(created.body.email, 'friend@example.invalid');
  assert.equal(created.headers['x-roamly-account'], identity);
  assert.equal(created.headers['x-roamly-csrf'], 'browser-csrf');
  await dialog.getByRole('button', { name: 'Revogar: friend@example.invalid', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: 'Convite revogado' }).waitFor();
  assert.equal(await dialog.locator('.share-person').count(), 0);
}));

test('an invited user saves a shared map directly into their own itineraries', { timeout: 60_000 }, async (t) => run(t, { signedIn: true }, async (page, state) => {
  await page.goto(baseUrl + '/share/browser-share');
  await page.getByRole('heading', { name: 'Roma', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Salvar em Meus roteiros', exact: true }).click();
  await page.waitForURL(baseUrl + '/');
  await page.locator('h1').filter({ hasText: 'Seu roteiro em Roma' }).waitFor();
  await page.locator('.desktop-list .place-row').filter({ hasText: place.name }).waitFor();
  const imported = state.requests.find((request) => request.path === '/api/shares/import');
  assert.deepEqual(imported.body, { shareId: 'browser-share' });
  assert.equal(imported.headers['x-roamly-account'], identity);
  assert.equal(imported.headers['x-roamly-csrf'], 'browser-csrf');
}));

test('signed-in offline note survives reload, then syncs without a request loop', { timeout: 60_000 }, async (t) => run(t, { signedIn: true }, async (page, state) => {
  await home(page); await page.locator('.sync-pill.synced').waitFor(); await selectPlace(page);
  state.offline = true;
  await page.evaluate(() => { localStorage.setItem('test-offline', 'true'); window.__testOnline = false; dispatchEvent(new Event('offline')); });
  await page.getByLabel('NOTA PESSOAL', { exact: true }).fill('Ingresso salvo offline');
  await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.includes('roamly-pending:')));
  await page.reload(); await page.locator('h1').filter({ hasText: 'Seu roteiro em Roma' }).waitFor(); await selectPlace(page);
  assert.equal(await page.getByLabel('NOTA PESSOAL', { exact: true }).inputValue(), 'Ingresso salvo offline');
  await page.locator('.sync-notice').getByRole('status').filter({ hasText: 'Sem conexão' }).waitFor();
  state.offline = false;
  await page.evaluate(() => { localStorage.removeItem('test-offline'); window.__testOnline = true; dispatchEvent(new Event('online')); });
  await page.locator('.sync-pill.synced').waitFor(); assert.equal(state.data.places[0].note, 'Ingresso salvo offline');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('roamly-pending:')).length), 0);
  // Allow the one debounce caused by initial hydration, but no continuous GET cycle.
  await page.waitForTimeout(1500); const reads = state.requests.filter((r) => r.path === '/api/sync').length;
  await page.waitForTimeout(2200); assert.equal(state.requests.filter((r) => r.path === '/api/sync').length, reads);
}));

test('mobile conflict shows both notes and resolves either version without losing a pin edit', { timeout: 60_000 }, async (t) => {
  for (const choice of ['local', 'cloud']) await run(t, { signedIn: true, mobile: true }, async (page, state) => {
    await home(page); await page.locator('.header-actions .sync-pill.synced').waitFor({ state: 'attached' });
    await page.locator('.bottom-nav').getByRole('button', { name: 'Lista', exact: true }).click();
    await page.locator('.mobile-list .place-row').click();
    // Mobile detail opens after switching back to map.
    await page.locator('.bottom-nav').getByRole('button', { name: 'Mapa', exact: true }).click();
    state.offline = true;
    await page.evaluate(() => { window.__testOnline = false; dispatchEvent(new Event('offline')); });
    await page.getByLabel('NOTA PESSOAL', { exact: true }).fill('Nota deste celular');
    await page.getByRole('button', { name: 'COR DO PIN: Azul', exact: true }).click();
    await page.waitForFunction(() => Object.keys(localStorage).filter((key) => key.includes('roamly-pending:')).length >= 2);
    state.data.places[0].note = 'Nota de outro aparelho'; state.revision++;
    state.offline = false; await page.evaluate(() => { window.__testOnline = true; dispatchEvent(new Event('online')); });
    const notice = page.locator('.sync-notice');
    await notice.getByText('Nota deste celular', { exact: true }).waitFor(); await notice.getByText('Nota de outro aparelho', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (choice === 'local') {
      await page.getByRole('button', { name: 'Ativar modo noturno', exact: true }).click();
      await mkdir('test-results', { recursive: true });
      await page.screenshot({ path: 'test-results/sync-mobile-conflict.png', fullPage: true });
    }
    await notice.getByRole('button', { name: choice === 'local' ? 'Manter minhas alterações' : 'Usar versão da nuvem', exact: true }).click();
    await page.locator('.sync-pill.synced').waitFor({ state: 'attached' });
    assert.equal(state.data.places[0].note, choice === 'local' ? 'Nota deste celular' : 'Nota de outro aparelho');
    assert.ok(state.data.places[0].pinColor); await notice.waitFor({ state: 'detached' });
  });
});

test('storage failure preserves the note and permits an offline rescue download', { timeout: 60_000 }, async (t) => run(t, { signedIn: true }, async (page, state) => {
  await home(page); await page.locator('.sync-pill.synced').waitFor(); await selectPlace(page);
  state.offline = true;
  await page.evaluate(() => {
    window.__testOnline = false; dispatchEvent(new Event('offline'));
    Storage.prototype.setItem = () => { throw new DOMException('No storage space', 'QuotaExceededError'); };
  });
  await page.getByLabel('NOTA PESSOAL', { exact: true }).fill('Nota que não pode sumir');
  await page.locator('.sync-notice').getByRole('alert').filter({ hasText: 'Não foi possível guardar' }).waitFor();
  assert.equal(await page.getByLabel('NOTA PESSOAL', { exact: true }).inputValue(), 'Nota que não pode sumir');
  const download = page.waitForEvent('download'); await page.locator('.sync-notice').getByRole('button', { name: 'Baixar uma cópia', exact: true }).click();
  const file = await download; const stream = await file.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString()); assert.equal(data.localItinerary.places[0].note, 'Nota que não pode sumir'); assert.equal(data.cloudUnavailable, true); assert.ok(data.pendingEdits.length);
}));

test('saved search works with Maps ready, does not call autocomplete, and first photos are shared by rows and details without sync loops', { timeout: 60_000 }, async (t) => run(t, { signedIn: true, mapsReady: true }, async (page, state) => {
  await home(page); await page.locator('.sync-pill.synced').waitFor(); await selectPlace(page);
  await page.locator('.place-photo img').waitFor(); assert.match(await page.locator('.place-photo img').getAttribute('src'), /first\.png$/);
  assert.match(await page.locator('.desktop-list .row-photo img').getAttribute('src'), /first\.png$/);
  await page.locator('.photo-credit').getByText('Autor sem link', { exact: true }).waitFor();
  assert.equal(await page.locator('gmp-place-details-compact').count(), 0); assert.equal(await page.evaluate(() => window.__placesRequests), 1);
  await page.getByLabel('Buscar no seu roteiro', { exact: true }).fill('sem correspondência');
  await page.locator('.desktop-panel').getByText('Nenhum local corresponde à busca', { exact: true }).waitFor(); assert.equal(await page.locator('.desktop-list .place-row').count(), 0);
  assert.equal(await page.evaluate(() => window.__autocompleteCalls), 0);
  await page.getByLabel('Buscar no seu roteiro', { exact: true }).fill('Endereço atualizado'); await page.locator('.desktop-list .place-row').waitFor();
  await page.getByLabel('Onde buscar', { exact: true }).selectOption('google'); await page.getByLabel('Buscar no Google Maps', { exact: true }).fill('museu');
  await page.waitForFunction(() => window.__autocompleteCalls > 0);
  await page.getByLabel('Onde buscar', { exact: true }).selectOption('saved');
  await page.waitForTimeout(1800); const reads = state.requests.filter((request) => request.path === '/api/sync').length;
  await page.waitForTimeout(2200); assert.equal(state.requests.filter((request) => request.path === '/api/sync').length, reads);
}));

test('dialogs trap Tab, close with Escape, restore focus and explain account-wide deletion', { timeout: 60_000 }, async (t) => run(t, { signedIn: true }, async (page) => {
  await home(page); await page.locator('.sync-pill.synced').waitFor();
  const invoker = page.getByRole('button', { name: 'Trocar mapa de viagem', exact: true }); await invoker.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'SEUS MAPAS', exact: true }); await dialog.waitFor();
  for (let index = 0; index < 16; index++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.closest('dialog')?.open === true), true); }
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); assert.equal(await invoker.evaluate((element) => element === document.activeElement), true);
  await switchMap(page); await page.getByRole('button', { name: 'Excluir mapa Roma', exact: true }).click();
  const alert = page.getByRole('alertdialog'); await alert.getByText(/conta e dos seus aparelhos/).waitFor(); await alert.getByText(/Cópias já salvas/).waitFor();
  await page.keyboard.press('Escape'); await alert.waitFor({ state: 'detached' }); assert.equal(await page.getByRole('button', { name: 'Excluir mapa Roma', exact: true }).evaluate((element) => element === document.activeElement), true);
}));

test('guest and authenticated sessions tolerate storage getter/read failures; cloud view remains read-only and exportable', { timeout: 60_000 }, async (t) => {
  for (const [signedIn, blockStorage] of [[false, 'getter'], [true, 'getter'], [true, 'read']]) await run(t, { signedIn, blockStorage }, async (page, state) => {
    await page.goto(baseUrl); await page.locator('h1').filter({ hasText: signedIn ? 'Seu roteiro em Roma' : 'Seu roteiro em Madri' }).waitFor();
    await page.locator('.sync-notice').getByRole('alert').waitFor();
    await page.getByLabel('Idioma', { exact: true }).selectOption('en'); await page.locator('h1').filter({ hasText: signedIn ? 'Your itinerary in Roma' : 'Your itinerary in Madri' }).waitFor();
    assert.equal(state.requests.filter((request) => request.method === 'PUT').length, 0);
    const download = page.waitForEvent('download'); await page.locator('.sync-notice').getByRole('button', { name: 'Download a copy', exact: true }).click(); await download;
  });
});

test('remote removal closes the exact route/confirmation target without a crash or changing destination', { timeout: 60_000 }, async (t) => run(t, { signedIn: true }, async (page, state) => {
  await home(page); await page.locator('.sync-pill.synced').waitFor(); await selectPlace(page); await page.getByRole('button', { name: 'Ir com Maps', exact: true }).click();
  await page.getByRole('dialog', { name: 'Escolher meio de transporte' }).waitFor(); state.data.places = []; state.revision++;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.getByRole('dialog', { name: 'Escolher meio de transporte' }).waitFor({ state: 'detached' }); await page.locator('.desktop-list .place-row').waitFor({ state: 'detached' });
}));

test('mobile GPS distances sort nearest first and no viewport overflow is introduced', { timeout: 60_000 }, async (t) => run(t, { mobile: true, mapsReady: true, location: true, data: { maps: ['Roma'], currentMap: 'Roma', places: [{ ...place, name: 'Zulu perto', lat: -27.5901 }, { ...place, id: 'far', placeId: 'ChIJFar', name: 'Alpha longe', lat: -27.7 }] } }, async (page) => {
  await home(page); await page.locator('.bottom-nav').getByRole('button', { name: 'Lista', exact: true }).click();
  await page.getByRole('button', { name: 'Ativar distância e ordenar', exact: true }).click();
  await page.getByRole('dialog').locator('.privacy-primary').click();
  await page.locator('.distance-sort-state.ready').waitFor();
  assert.match(await page.locator('.mobile-list .place-row').first().innerText(), /Zulu perto/); assert.match(await page.locator('.mobile-list .row-distance').first().innerText(), /\d+ m/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/mobile-photos-distance.png', fullPage: true });
}));
