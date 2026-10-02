import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { runtime, memoryStorage } from './helpers/runtime.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(path.join(root, 'app/trip-guide/use-trip-guide.ts'), 'utf8');
const ast = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const home = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'useTripGuide');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function waitUntil(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.ok(predicate(), 'Expected asynchronous operation to finish');
}

const user = (id) => ({ id, generation: `gen-${id}`, email: `${id.toLowerCase()}@example.invalid`, name: id });
const identity = (value) => `${value.id}:${value.generation}`;
const req = (endpoint, headers = {}, body = '{}', method = 'POST') => new Request(`https://app.example.invalid${endpoint}`, {
  method, headers: { Origin: 'https://app.example.invalid', 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body }),
});
const cookiePair = (value) => value.split(';')[0];
const accountHeader = (cookie) => {
  const token = cookie.split('=')[1].split('.')[0];
  const payload = JSON.parse(Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64url').toString());
  return `${payload.id}:${payload.generation}`;
};
const sessionUser = (cookie) => {
  const token = cookie.split('=')[1].split('.')[0];
  return JSON.parse(Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64url').toString());
};

async function challenge(r) {
  const response = await r.load('app/api/auth/challenge/route.ts').POST(req('/api/auth/challenge'));
  assert.equal(response.status, 200);
  return { token: (await response.json()).token, cookie: cookiePair(response.headers.get('set-cookie')) };
}

test('login rejects original cross-site text/plain form, null/missing Origin and non-JSON variants before Google or cookies', async () => {
  const r = runtime();
  const login = r.load('app/api/auth/google/route.ts').POST;
  for (const headers of [
    { Origin: 'https://evil.example.invalid', 'Content-Type': 'text/plain' },
    { Origin: 'null' }, { Origin: '' }, { Origin: 'https://app.example.invalid.evil.invalid' },
    { 'Content-Type': 'application/x-www-form-urlencoded' }, { 'Content-Type': 'text/plain' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'https://evil.example.invalid', 'X-Forwarded-Host': 'evil.example.invalid' },
  ]) {
    const response = await login(req('/api/auth/google', headers, '{"credential":"attacker","padding":"="}'));
    assert.ok([403, 415].includes(response.status));
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal(r.state.googleCalls, 0);
});

test('login requires matching signed, unexpired browser challenge; genuine same-origin JSON login succeeds', async () => {
  const r = runtime();
  const login = r.load('app/api/auth/google/route.ts').POST;
  const c = await challenge(r);
  for (const headers of [ {}, { Cookie: c.cookie }, { 'X-Roamly-CSRF': c.token },
    { Cookie: c.cookie, 'X-Roamly-CSRF': c.token + 'x' },
    { Cookie: 'roamly_login_challenge=fake.fake', 'X-Roamly-CSRF': 'fake.fake' },
    { Cookie: c.cookie + '; ' + c.cookie, 'X-Roamly-CSRF': c.token },
  ]) assert.equal((await login(req('/api/auth/google', headers, '{"credential":"valid"}'))).status, 403);
  assert.equal(r.state.googleCalls, 0);
  const originalDate = Date;
  r.context.Date = class extends originalDate { static now() { return originalDate.now() + 601_000; } };
  assert.equal((await login(req('/api/auth/google', { Cookie: c.cookie, 'X-Roamly-CSRF': c.token }, '{"credential":"valid"}'))).status, 403);
  delete r.context.Date;
  const response = await login(req('/api/auth/google', { Cookie: c.cookie, 'X-Roamly-CSRF': c.token, 'Content-Type': 'application/json; charset=UTF-8' }, '{"credential":"valid"}'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, 'B');
  assert.equal(r.state.googleCalls, 1);
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith('roamly_session=')));
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.includes('roamly_login_challenge=;')));
});

test('challenge endpoint cannot be created by external or form requests', async () => {
  const r = runtime();
  for (const headers of [{ Origin: 'https://evil.invalid' }, { Origin: 'null' }, { 'Content-Type': 'text/plain' }]) {
    const response = await r.load('app/api/auth/challenge/route.ts').POST(req('/api/auth/challenge', headers));
    assert.ok([403, 415].includes(response.status));
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('GET and PUT reject stale/missing owner before DB access; valid same-account read/write remain authorized', async () => {
  const r = runtime();
  const sync = r.load('app/api/sync/route.ts');
  r.state.cookie = cookiePair(await r.auth.createSessionCookie(user('B'), req('/')));
  r.rows.set('B', JSON.stringify({ maps: ['B private'], currentMap: 'B private', places: [] }));
  const owner = accountHeader(r.state.cookie);
  const original = r.rows.get('B');
  for (const method of ['GET', 'PUT']) {
    for (const owner of ['', 'A', 'B, A']) {
      const response = await sync[method](req('/api/sync', { Cookie: r.state.cookie, 'X-Roamly-Account': owner }, '{"maps":["A"],"currentMap":"A","places":[]}', method));
      assert.equal(response.status, 409);
    }
  }
  assert.ok(r.state.dbCalls > 0); // generation lookup occurs before validating account header
  assert.equal(r.rows.get('B'), original);
  const valid = req('/api/sync', { Cookie: r.state.cookie, 'X-Roamly-Account': owner }, JSON.stringify({ maps: ['B new'], currentMap: 'B new', places: [{ placeId: 'p', distance: '3 km' }], user_id: 'A', baseRevision: 0, mutationIds: [crypto.randomUUID()] }), 'PUT');
  assert.equal((await sync.PUT(valid)).status, 200);
  assert.equal(r.rows.has('A'), false);
  assert.equal(JSON.parse(r.rows.get('B')).places[0].distance, undefined);
  const read = await sync.GET(req('/api/sync', { Cookie: r.state.cookie, 'X-Roamly-Account': owner }, '', 'GET'));
  const body = await read.json();
  assert.equal(body.userId, owner);
  assert.deepEqual(body.data.maps, ['B new']);
  assert.equal(body.data.places[0].distance, undefined);
  assert.equal((await sync.PUT(req('/api/sync', { 'X-Roamly-Account': owner }, '{}', 'PUT'))).status, 401);
  assert.equal((await sync.PUT(req('/api/sync', { Cookie: r.state.cookie, 'X-Roamly-Account': owner, Origin: 'https://evil.invalid' }, '{}', 'PUT'))).status, 403);
});

test('stale logout cannot clear new account; genuine logout clears session and challenge', async () => {
  const r = runtime(), c = await challenge(r);
  const session = cookiePair(await r.auth.createSessionCookie(user('B'), req('/')));
  const headers = { Cookie: `${session}; ${c.cookie}`, 'X-Roamly-CSRF': c.token, 'X-Roamly-Account': 'A' };
  const logout = r.load('app/api/auth/logout/route.ts').POST;
  const rejected = await logout(req('/api/auth/logout', headers));
  assert.equal(rejected.status, 409);
  assert.equal(rejected.headers.get('set-cookie'), null);
  const accepted = await logout(req('/api/auth/logout', { ...headers, 'X-Roamly-Account': accountHeader(session) }));
  assert.equal(accepted.status, 200);
  assert.ok(accepted.headers.getSetCookie().some((cookie) => cookie.startsWith('roamly_session=;') && cookie.includes('Max-Age=0')));
});

test('account deletion requires CSRF and exact account generation, deletes itinerary and invalidates old session', async () => {
  const r = runtime(), c = await challenge(r);
  const session = cookiePair(await r.auth.createSessionCookie(user('B'), req('/')));
  const sync = r.load('app/api/sync/route.ts');
  r.rows.set('B', JSON.stringify({ maps: ['B'], currentMap: 'B', places: [{ placeId: 'p', distance: 12 }] }));
  const headers = { Cookie: `${session}; ${c.cookie}`, 'X-Roamly-CSRF': c.token, 'X-Roamly-Account': accountHeader(session) };
  assert.equal((await sync.DELETE(req('/api/sync', { ...headers, 'X-Roamly-Account': 'B' }, '{}', 'DELETE'))).status, 409);
  assert.equal((await sync.DELETE(req('/api/sync', { Cookie: session, 'X-Roamly-Account': accountHeader(session) }, '{}', 'DELETE'))).status, 403);
  const response = await sync.DELETE(req('/api/sync', headers, '{}', 'DELETE'));
  assert.equal(response.status, 200);
  assert.equal(r.rows.has('B'), false);
  assert.equal(r.accounts.has('B'), false);
  assert.equal(await r.auth.getSessionUser(req('/', { Cookie: session }, '', 'GET')), null);
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith('roamly_session=;') && cookie.includes('Max-Age=0')));
});

test('map shares are email-bound, owner-scoped, revocable and exclude personal notes and live distance', async () => {
  const r = runtime();
  const ownerCookie = cookiePair(await r.auth.createSessionCookie(user('A'), req('/')));
  const owner = accountHeader(ownerCookie);
  r.rows.set('A', JSON.stringify({ maps: ['Roma'], currentMap: 'Roma', places: [
    { id: 'p1', placeId: 'google-place-1', destination: 'Roma', name: 'Colosseo', address: 'Piazza del Colosseo', note: 'Surpresa especial', distance: '12 m', photo: 'https://images.invalid/colosseo.jpg' },
    { id: 'p2', placeId: 'google-place-2', destination: 'Madri', name: 'Prado', note: 'Private note' },
  ] }));
  const c = await challenge(r);
  const headers = { Cookie: `${ownerCookie}; ${c.cookie}`, 'X-Roamly-CSRF': c.token, 'X-Roamly-Account': owner };
  const shares = r.load('app/api/shares/route.ts');
  assert.equal((await shares.POST(req('/api/shares', { Cookie: ownerCookie, 'X-Roamly-Account': owner }, JSON.stringify({ mapName: 'Roma', email: 'friend@example.invalid' })))).status, 403);
  const created = await shares.POST(req('/api/shares', headers, JSON.stringify({ mapName: 'Roma', email: ' Friend@Example.Invalid ' })));
  assert.equal(created.status, 201);
  const createdPayload = await created.json();
  const { shareId } = createdPayload;
  assert.equal(createdPayload.emailSent, false);
  assert.ok(shareId);
  const duplicate = await shares.POST(req('/api/shares', headers, JSON.stringify({ mapName: 'Roma', email: 'friend@example.invalid' })));
  assert.equal((await duplicate.json()).shareId, shareId);
  const inviteList = await shares.GET(req('/api/shares', { Cookie: ownerCookie, 'X-Roamly-Account': owner }, '', 'GET'));
  assert.equal((await inviteList.json()).shares[0].invited_email, 'friend@example.invalid');

  const guestCookie = cookiePair(await r.auth.createSessionCookie(user('C'), req('/')));
  const rejected = await shares.GET(req(`/api/shares?shareId=${shareId}`, { Cookie: guestCookie }, '', 'GET'));
  assert.equal(rejected.status, 404);
  const inviteeCookie = cookiePair(await r.auth.createSessionCookie({ ...user('B'), email: 'friend@example.invalid' }, req('/')));
  const visible = await shares.GET(req(`/api/shares?shareId=${shareId}`, { Cookie: inviteeCookie }, '', 'GET'));
  assert.equal(visible.status, 200);
  const payload = await visible.json();
  assert.equal(payload.map.name, 'Roma');
  assert.equal(payload.map.places.length, 1);
  assert.equal(payload.map.places[0].name, 'Colosseo');
  assert.equal(payload.map.places[0].note, undefined);
  assert.equal(payload.map.places[0].distance, undefined);

  const inviteeChallenge = await challenge(r);
  const inviteeOwner = accountHeader(inviteeCookie);
  const importHeaders = { Cookie: `${inviteeCookie}; ${inviteeChallenge.cookie}`, 'X-Roamly-CSRF': inviteeChallenge.token, 'X-Roamly-Account': inviteeOwner };
  const importRoute = r.load('app/api/shares/import/route.ts').POST;
  const saved = await importRoute(req('/api/shares/import', importHeaders, JSON.stringify({ shareId })));
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true, mapName: 'Roma', addedCount: 1, revision: 1 });
  const recipientData = JSON.parse(r.rows.get('B'));
  assert.deepEqual(recipientData.maps, ['Roma']);
  assert.equal(recipientData.currentMap, 'Roma');
  assert.equal(recipientData.places[0].placeId, 'google-place-1');
  assert.equal(recipientData.places[0].destination, 'Roma');
  assert.equal(recipientData.places[0].note, '');
  assert.equal(recipientData.places[0].distance, undefined);
  const savedAgain = await importRoute(req('/api/shares/import', importHeaders, JSON.stringify({ shareId })));
  assert.equal((await savedAgain.json()).addedCount, 0);
  assert.equal(JSON.parse(r.rows.get('B')).places.length, 1);
  const wrongEmail = await importRoute(req('/api/shares/import', { Cookie: `${guestCookie}; ${inviteeChallenge.cookie}`, 'X-Roamly-CSRF': inviteeChallenge.token, 'X-Roamly-Account': accountHeader(guestCookie) }, JSON.stringify({ shareId })));
  assert.equal(wrongEmail.status, 404);

  const revoked = await shares.DELETE(req(`/api/shares?shareId=${shareId}`, headers, '{}', 'DELETE'));
  assert.equal(revoked.status, 200);
  assert.equal((await shares.GET(req(`/api/shares?shareId=${shareId}`, { Cookie: inviteeCookie }, '', 'GET'))).status, 404);

  const restored = await shares.POST(req('/api/shares', headers, JSON.stringify({ mapName: 'Roma', email: 'friend@example.invalid' })));
  const secondShareId = (await restored.json()).shareId;
  const deletedAccount = await r.load('app/api/sync/route.ts').DELETE(req('/api/sync', headers, '{}', 'DELETE'));
  assert.equal(deletedAccount.status, 200);
  assert.equal(r.shares.size, 0);
  assert.equal((await shares.GET(req(`/api/shares?shareId=${secondShareId}`, { Cookie: inviteeCookie }, '', 'GET'))).status, 404);
});

test('new invitations send a trusted Easy Road Map email through Resend when configured', async () => {
  const r = runtime();
  r.context.process.env.RESEND_API_KEY = 'test-resend-key';
  r.context.process.env.RESEND_FROM_EMAIL = 'invites@example.invalid';
  const ownerCookie = cookiePair(await r.auth.createSessionCookie(user('A'), req('/')));
  const owner = accountHeader(ownerCookie);
  r.rows.set('A', JSON.stringify({ maps: ['Paris <script>alert(1)</script>'], currentMap: '', places: [] }));
  const csrf = await challenge(r);
  const headers = { Cookie: `${ownerCookie}; ${csrf.cookie}`, 'X-Roamly-CSRF': csrf.token, 'X-Roamly-Account': owner };
  const shares = r.load('app/api/shares/route.ts');
  const created = await shares.POST(req('/api/shares', headers, JSON.stringify({ mapName: 'Paris <script>alert(1)</script>', email: 'friend@example.invalid' })));
  assert.equal(created.status, 201);
  const payload = await created.json();
  assert.equal(payload.emailSent, true);
  assert.equal(r.state.emailCalls.length, 1);
  const email = r.state.emailCalls[0];
  assert.equal(email.headers.get('Authorization'), 'Bearer test-resend-key');
  assert.deepEqual(email.body.to, ['friend@example.invalid']);
  assert.match(email.body.html, /https:\/\/roamly-trip-guide-arthur\.arthurmaquizito\.chatgpt\.site\/share\//);
  assert.match(email.body.html, /&lt;script&gt;/);
  assert.doesNotMatch(email.body.html, /<script>alert/);
});

test('all five cache copies are owner-scoped; legacy data stays guest-only and account IDs cannot alias guest', () => {
  const r = runtime(), raw = memoryStorage();
  const guest = r.security.accountStorage(raw, null), a = r.security.accountStorage(raw, 'A'), b = r.security.accountStorage(raw, 'B');
  for (const key of ['roamly-maps', 'roamly-current-map', 'roamly-place-refs', 'roamly-notes', 'roamly-removed-place-keys']) {
    raw.setItem(key, 'legacy');
    assert.equal(guest.getItem(key), 'legacy');
    assert.equal(a.getItem(key), null);
    a.setItem(key, 'private A');
    b.setItem(key, 'private B');
    assert.equal(a.getItem(key), 'private A');
    assert.equal(b.getItem(key), 'private B');
    assert.equal(guest.getItem(key), 'legacy');
    assert.equal(r.security.accountStorage(raw, 'guest').getItem(key), null);
  }
  assert.equal(/localStorage\.(getItem|setItem)\((?:'roamly-(?:maps|current-map|place-refs|notes)'|removedPlacesStorageKey)/.test(page), false);
});

function installPageFunctions(r) {
  for (const name of ['placeKey', 'dedupePlaces', 'restoreLocalItinerary']) {
    const file = 'place-model.ts';
    const source = readFileSync(path.join(root, 'app/trip-guide', file), 'utf8');
    const modelAst = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = modelAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
    vm.runInContext(compile(declaration.getText(modelAst).replace(/^export /, '')), r.context);
  }
  Object.assign(r.context, { readSafeItinerary: r.load('app/place-schema.ts').readSafeItinerary, browserStorage: () => r.context.localStorage, initialPlaces: [], legacyPlaceIds: { old: 'new' }, removedPlacesStorageKey: 'roamly-removed-place-keys', accountIdentity: identity, withoutDistance: (place) => { const result = { ...place }; delete result.distance; return result; }, clearOtherAccountGenerations() {} });
}

function effectSource(fragment) {
  const statement = home.body.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect' && node.getText(ast).includes(fragment));
  assert.ok(statement, `Effect missing: ${fragment}`);
  return statement.expression.arguments[0].getText(ast);
}

test('cache restoration preserves note precedence, empty maps, deleted places and legacy IDs without cross-account fallback', () => {
  const r = runtime(); installPageFunctions(r);
  const raw = memoryStorage(), a = r.security.accountStorage(raw, 'A'), b = r.security.accountStorage(raw, 'B');
  a.setItem('roamly-maps', '["Madrid"]');
  a.setItem('roamly-place-refs', '[{"id":"one","placeId":"old","destination":"Madrid","note":"old note"}]');
  a.setItem('roamly-notes', '{"one":"latest private note"}');
  let result = r.context.restoreLocalItinerary(a, false);
  assert.equal(result.places[0].note, 'latest private note');
  assert.equal(result.places[0].placeId, 'new');
  assert.equal(r.context.restoreLocalItinerary(b, false).places.length, 0);
  a.setItem('roamly-removed-place-keys', '["old:madrid"]');
  assert.equal(r.context.restoreLocalItinerary(a, false).places.length, 0);
  a.setItem('roamly-maps', '[]');
  result = r.context.restoreLocalItinerary(a, false);
  assert.equal(result.maps.length, 0);
  assert.equal(result.currentMap, '');
});

test('actual old-tab autosave sends captured A, is rejected under cookie B and never overwrites B', async () => {
  const r = runtime(); installPageFunctions(r);
  r.state.cookie = cookiePair(await r.auth.createSessionCookie(user('B'), req('/')));
  r.rows.set('B', '{"private":"original B"}');
  const timers = [], flags = { reloads: 0, statuses: [] };
  Object.assign(r.context, {
    authUser: user('A'), cacheOwner: identity(user('A')), storageReady: true,
    cloudLoadedForUserRef: { current: identity(user('A')) }, accountActiveRef: { current: true },
    syncEngineRef: { current: new (r.load('app/trip-guide/sync-engine.ts').SyncEngine)(identity(user('A')), r.context.localStorage, { maps: ['A'], currentMap: 'A', places: [] }, () => r.context.accountActiveRef.current) },
    navigator: { onLine: true }, applySyncResult() {},
    setSyncStatus: (value) => flags.statuses.push(value), reloadForAccountChange: () => flags.reloads++,
    window: { setTimeout: (fn) => { timers.push(fn); return 1; }, clearTimeout() {} },
  });
  vm.runInContext(compile(`(${effectSource('const timer = window.setTimeout')})()`), r.context);
  timers[0](); await waitUntil(() => flags.reloads === 1);
  assert.equal(r.state.requests[0].headers.get('x-roamly-account'), identity(user('A')));
  assert.equal(r.rows.get('B'), '{"private":"original B"}');
  assert.deepEqual(r.rows.get('B'), '{"private":"original B"}');
  assert.equal(flags.reloads, 1);
  // A queued timer cannot run once logout or a cross-tab event begins.
  r.context.accountActiveRef.current = false;
  timers[0](); await tick();
  assert.equal(r.state.requests.length, 1);
});

test('empty-account load never uploads guest data without explicit consent; existing cloud data never prompts', async () => {
  for (const consent of [false, true, 'existing']) {
    const r = runtime(); installPageFunctions(r);
    const guest = r.security.accountStorage(r.context.localStorage, null);
    guest.setItem('roamly-maps', '["Guest"]');
    guest.setItem('roamly-place-refs', '[{"id":"p","placeId":"p","destination":"Guest","note":"private legacy"}]');
    r.state.cookie = cookiePair(await r.auth.createSessionCookie(user('B'), req('/')));
    if (consent === 'existing') r.rows.set('B', '{"maps":["B"],"currentMap":"B","places":[]}');
    const seen = { prompts: 0, places: null, maps: null };
    Object.assign(r.context, {
      authUser: sessionUser(r.state.cookie), cacheOwner: accountHeader(r.state.cookie), storageReady: true, language: 'pt',
      cloudLoadedForUserRef: { current: '' }, accountActiveRef: { current: true }, hydratedPlaceKeysRef: { current: new Set() },
      syncEngineRef: { current: new (r.load('app/trip-guide/sync-engine.ts').SyncEngine)(accountHeader(r.state.cookie), r.context.localStorage, { maps: [], currentMap: '', places: [] }) },
      navigator: { onLine: true }, applySyncResult: (result) => { seen.maps = result.data.maps; seen.places = result.data.places; },
      setSyncStatus() {}, setMaps: (value) => { seen.maps = value; }, setCurrentMap() {}, setPlaces: (value) => { seen.places = value; }, setSelectedId() {},
      reloadForAccountChange() { throw new Error('Unexpected account change'); },
      window: { confirm: () => { seen.prompts++; return consent === true; } },
    });
    vm.runInContext(compile(`(${effectSource('const offerGuest')})()`), r.context);
    await waitUntil(() => seen.places !== null);
    assert.equal(r.state.requests.filter((request) => request.method === 'PUT').length, consent === true ? 1 : 0);
    assert.equal(seen.prompts, consent === 'existing' ? 0 : 1);
    assert.equal(seen.places.length, consent === true ? 1 : 0);
    assert.equal(seen.places[0]?.note, consent === true ? 'private legacy' : undefined);
    assert.equal(r.context.cloudLoadedForUserRef.current, accountHeader(r.state.cookie));
  }
});

test('cancelled cloud response cannot replace data or enable saving after account transition', async () => {
  const r = runtime(); installPageFunctions(r);
  r.state.cookie = cookiePair(await r.auth.createSessionCookie(user('A'), req('/')));
  let resolve;
  r.security.accountFetch = () => new Promise((done) => { resolve = done; });
  Object.assign(r.context, {
    authUser: sessionUser(r.state.cookie), cacheOwner: accountHeader(r.state.cookie), storageReady: true, language: 'pt',
    cloudLoadedForUserRef: { current: '' }, accountActiveRef: { current: true },
    syncEngineRef: { current: new (r.load('app/trip-guide/sync-engine.ts').SyncEngine)(accountHeader(r.state.cookie), r.context.localStorage, { maps: [], currentMap: '', places: [] }, () => r.context.accountActiveRef.current) },
    navigator: { onLine: true }, applySyncResult() { throw new Error('Stale response applied'); },
    setSyncStatus() {}, setMaps() { throw new Error('Stale response applied'); },
  });
  const cleanup = vm.runInContext(compile(`(${effectSource('const offerGuest')})()`), r.context);
  cleanup();
  r.context.accountActiveRef.current = false;
  resolve(Response.json({ userId: accountHeader(r.state.cookie), revision: 0, data: { maps: ['A'], currentMap: 'A', places: [] } }));
  await tick(); await tick();
  assert.equal(r.context.cloudLoadedForUserRef.current, '');
});

test('failed logout must not mark an uninitialized cloud snapshot ready for autosave', async () => {
  const r = runtime(); installPageFunctions(r);
  const logout = home.body.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'logout');
  Object.assign(r.context, {
    authUser: user('A'), cacheOwner: identity(user('A')), storageReady: true,
    accountActiveRef: { current: true }, cloudLoadedForUserRef: { current: '' },
    accountTransitionRef: { current: 0 },
    syncEngineRef: { current: {} }, navigator: { onLine: true },
    authChallenge: async () => { throw new Error('Offline'); },
    setAuthLoading() {}, setAuthError() {}, setSyncAttempt() {},
    maps: ['New trip'], currentMap: 'New trip', places: [],
    window: { setTimeout() { throw new Error('Unsafe autosave scheduled'); }, clearTimeout() {} },
  });
  vm.runInContext(compile(logout.getText(ast)), r.context);
  await r.context.logout();
  assert.equal(r.context.cloudLoadedForUserRef.current, '');
  assert.equal(r.context.accountActiveRef.current, true);
  vm.runInContext(compile(`(${effectSource('const timer = window.setTimeout')})()`), r.context);
  assert.equal(r.state.requests.length, 0);
});

test('server-confirmed account deletion stays final when local cache cleanup is blocked', async () => {
  const r = runtime(); installPageFunctions(r);
  const declaration = home.body.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'deleteMyData');
  let reloads = 0, warnings = 0;
  Object.assign(r.context, { authUser: user('A'), language: 'pt', accountActiveRef: { current: true }, cloudLoadedForUserRef: { current: identity(user('A')) },
    authChallenge: async () => 'token', accountFetch: async () => Response.json({ ok: true }), clearItineraryCache() { throw new Error('Storage blocked'); },
    setStorageIssue() { warnings++; }, stopLocationTracking() {}, announceAccountChange() {}, reloadForAccountChange() { reloads++; },
  });
  vm.runInContext(compile(declaration.getText(ast)), r.context); await r.context.deleteMyData();
  assert.equal(reloads, 1); assert.equal(warnings, 1); assert.equal(r.context.accountActiveRef.current, false); assert.equal(r.context.cloudLoadedForUserRef.current, '');
});

test('blocked cross-tab signaling cannot undo a confirmed account transition', () => {
  const r = runtime(); r.context.BroadcastChannel = class { constructor() { throw new Error('Blocked'); } };
  assert.doesNotThrow(() => r.security.announceAccountChange('A'));
  let closed = 0;
  r.context.BroadcastChannel = class { postMessage() { throw new Error('Blocked'); } close() { closed++; } };
  assert.doesNotThrow(() => r.security.announceAccountChange('A')); assert.equal(closed, 1);
});
