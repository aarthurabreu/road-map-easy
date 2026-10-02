import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, memoryStorage } from './helpers/runtime.mjs';

const json = (v) => JSON.parse(JSON.stringify(v));
const place = { id: 'p', placeId: 'ChIJSync', destination: 'Madri', name: 'Museu', category: 'Museu', address: 'Centro', hours: '09–18', status: 'open', statusLabel: 'Aberto', distance: '12 m', note: 'A', photo: '', x: 40, y: 50, rating: '4' };
const initial = () => ({ maps: ['Madri'], currentMap: 'Madri', places: [{ ...place }] });
const note = (data, value) => ({ ...structuredClone(data), places: data.places.map((p) => ({ ...p, note: value })) });
async function setup(data = initial()) {
  const r = runtime();
  r.state.cookie = (await r.auth.createSessionCookie({ id: 'A', generation: 'gen-A', email: 'a@example.invalid', name: 'A' }, new Request('https://app.example.invalid/'))).split(';')[0];
  const user = await r.auth.getSessionUser(new Request('https://app.example.invalid/', { headers: { Cookie: r.state.cookie } }));
  const owner = `${user.id}:${user.generation}`;
  if (data) r.rows.set('A', JSON.stringify(data));
  const storage = memoryStorage(), Engine = r.load('app/trip-guide/sync-engine.ts').SyncEngine;
  const create = (cache = storage, snapshot = data ?? { maps: [], currentMap: '', places: [] }, active) => new Engine(owner, cache, snapshot, active);
  const backend = r.load('app/api/_lib/itinerary-revisions.ts');
  const commit = (next, revision, ids = [crypto.randomUUID()]) => backend.commitItinerary(user, next, revision, ids);
  return { r, user, owner, storage, create, commit, backend };
}

test('CAS accepts one concurrent writer; a rejected deletion neither revokes invites nor records receipts', async () => {
  const f = await setup();
  f.r.sql.prepare('INSERT INTO map_shares (share_id, owner_user_id, owner_generation, map_name, invited_email, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), 'A', f.user.generation, 'Madri', 'b@example.invalid', 1);
  const winner = crypto.randomUUID(), loser = crypto.randomUUID();
  const results = await Promise.all([f.commit(note(initial(), 'B'), 0, [winner]), f.commit({ maps: [], currentMap: '', places: [] }, 0, [loser])]);
  assert.deepEqual(results.map((r) => r.saved), [true, false]); assert.equal(f.r.shares.size, 1);
  const read = await f.backend.readItinerary(f.user, [winner, loser]); assert.equal(read.revision, 1); assert.deepEqual(json(read.acknowledgedIds), [winner]);
  const response = await f.r.context.fetch('/api/sync', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Roamly-Account': f.owner }, body: JSON.stringify(initial()) });
  assert.equal(response.status, 428);
});

test('offline edits survive reload and merge a different field from another device', async () => {
  const f = await setup(), first = f.create(); await first.synchronize(); first.capture(note(first.current, 'Comprar ingresso'));
  await f.commit({ ...initial(), places: [{ ...place, pinColor: '#abc123' }] }, 0);
  const result = await f.create(f.storage, first.current).synchronize();
  assert.equal(result.conflicts.length, 0); assert.equal(result.pending, 0); assert.equal(result.data.places[0].note, 'Comprar ingresso'); assert.equal(result.data.places[0].pinColor, '#abc123');
  assert.equal(JSON.parse(f.r.rows.get('A')).places[0].distance, undefined);
});

test('same-field conflict preserves both versions; local choice keeps final A→B→C intent', async () => {
  const f = await setup(), engine = f.create(); await engine.synchronize(); engine.capture(note(engine.current, 'B')); engine.capture(note(engine.current, 'C'));
  await f.commit(note(initial(), 'C'), 0); const result = await engine.synchronize();
  assert.ok(result.conflicts.length); assert.equal(result.data.places[0].note, 'C'); assert.ok(engine.pending().length);
  engine.resolve('local'); const final = await engine.synchronize(); assert.equal(final.pending, 0); assert.equal(final.data.places[0].note, 'C');
});

test('cloud choice discards conflicting note but preserves independent local pin change', async () => {
  const f = await setup(), engine = f.create(); await engine.synchronize();
  const local = note(engine.current, 'Minha nota'); local.places[0].pinColor = '#123abc'; engine.capture(local);
  await f.commit(note(initial(), 'Outra nota'), 0); const result = await engine.synchronize(); assert.equal(result.conflicts[0].cloud, 'Outra nota');
  engine.resolve('cloud'); const final = await engine.synchronize(); assert.equal(final.data.places[0].note, 'Outra nota'); assert.equal(final.data.places[0].pinColor, '#123abc');
});

test('remote deletion is not silently undone by offline note; explicit local choice restores it', async () => {
  for (const choice of ['local', 'cloud']) {
    const f = await setup(), engine = f.create(); await engine.synchronize(); engine.capture(note(engine.current, 'Ingresso'));
    await f.commit({ maps: [], currentMap: '', places: [] }, 0); const result = await engine.synchronize();
    assert.ok(result.conflicts.length); assert.equal(JSON.parse(f.r.rows.get('A')).maps.length, 0);
    engine.resolve(choice); const final = await engine.synchronize(); assert.equal(final.data.places.length, choice === 'local' ? 1 : 0);
  }
});

test('lost save response plus later remote edit acknowledges old mutation without replay', async () => {
  const f = await setup(), engine = f.create(); await engine.synchronize(); engine.capture(note(engine.current, 'B'));
  const fetch = f.r.context.fetch;
  f.r.context.fetch = async (url, init) => { const response = await fetch(url, init); if (init?.method === 'PUT') throw new Error('Response lost'); return response; };
  await assert.rejects(engine.synchronize(), /Response lost/); assert.ok(engine.pending().length);
  f.r.context.fetch = fetch; await f.commit(note(initial(), 'C'), 1);
  const result = await f.create(f.storage, engine.current).synchronize(); assert.equal(result.data.places[0].note, 'C'); assert.equal(result.pending, 0); assert.equal(result.conflicts.length, 0);
  assert.equal((await f.backend.readItinerary(f.user)).revision, 2);
});

test('an edit captured during PUT stays queued until its own confirmation', async () => {
  const f = await setup(), engine = f.create(); await engine.synchronize(); engine.capture(note(engine.current, 'B'));
  const fetch = f.r.context.fetch; let captured = false;
  f.r.context.fetch = async (url, init) => { const response = await fetch(url, init); if (init?.method === 'PUT' && !captured) { captured = true; engine.capture(note(engine.current, 'C')); } return response; };
  const result = await engine.synchronize(); assert.equal(result.pending, 0); assert.equal(result.data.places[0].note, 'C'); assert.equal((await f.backend.readItinerary(f.user)).revision, 2);
});

test('two tabs share immutable entries and observe acknowledgments without resurrecting them', async () => {
  const f = await setup(), a = f.create(), b = f.create(); await a.synchronize(); await b.synchronize();
  a.capture(note(a.current, 'B')); b.capture({ ...b.current, places: [{ ...b.current.places[0], pinColor: '#456abc' }] });
  assert.equal(a.pending().length, 2); assert.equal(b.pending().length, 2); await a.synchronize(); assert.equal(b.pending().length, 0);
  const result = await b.synchronize(); assert.equal(result.data.places[0].note, 'B'); assert.equal(result.data.places[0].pinColor, '#456abc'); assert.equal((await f.backend.readItinerary(f.user)).revision, 1);
});

test('a conflict decision resolved in another tab cannot silently accept a stale local choice', async () => {
  const f = await setup(), a = f.create(), b = f.create(); await a.synchronize(); await b.synchronize();
  a.capture(note(a.current, 'B')); await f.commit(note(initial(), 'C'), 0); await a.synchronize(); await b.synchronize();
  b.resolve('cloud');
  assert.throws(() => a.resolve('local'), f.r.load('app/trip-guide/sync-engine.ts').ConflictChangedError);
  assert.equal((await a.synchronize()).data.places[0].note, 'C');
});

test('read data, revision and receipts use a single SQL snapshot', async () => {
  const f = await setup(), id = crypto.randomUUID(); await f.commit(note(initial(), 'B'), 0, [id]);
  const before = f.r.state.dbCalls, result = await f.backend.readItinerary(f.user, [id]);
  assert.equal(f.r.state.dbCalls - before, 1); assert.equal(result.data.places[0].note, 'B'); assert.equal(result.revision, 1); assert.deepEqual(json(result.acknowledgedIds), [id]);
});

test('first cloud save preserves legacy map plus new offline map and chained notes after reload', async () => {
  const f = await setup(null); f.r.security.accountStorage(f.storage, f.owner).setItem('roamly-maps', '["Madri"]');
  const first = f.create(f.storage, initial()); first.capture({ ...first.current, maps: ['Madri', 'Floripa'], currentMap: 'Floripa' }); first.capture(note(first.current, 'B')); first.capture(note(first.current, 'C'));
  const result = await f.create(f.storage, first.current).synchronize(); assert.deepEqual(json(result.data.maps), ['Madri', 'Floripa']); assert.equal(result.data.places[0].note, 'C'); assert.equal(result.conflicts.length, 0);
});

test('own empty cache or new offline edits do not repeatedly offer unrelated guest itineraries', async () => {
  for (const hasCache of [true, false]) {
    const f = await setup(null);
    if (hasCache) f.r.security.accountStorage(f.storage, f.owner).setItem('roamly-maps', '[]');
    const engine = f.create();
    if (!hasCache) engine.capture({ maps: ['Meu mapa'], currentMap: 'Meu mapa', places: [] });
    let prompts = 0; const result = await engine.synchronize(() => { prompts++; return initial(); });
    assert.equal(prompts, 0); assert.equal(result.data.maps.includes('Madri'), false);
  }
});

test('volatile edits stay in memory during storage failure and persist when storage recovers', async () => {
  const f = await setup(), engine = f.create(); await engine.synchronize(); const set = f.storage.setItem; f.storage.setItem = () => { throw new Error('QuotaExceeded'); };
  engine.capture(note(engine.current, 'Não perder')); assert.equal(engine.durable, false); assert.equal(engine.pending().length, 1);
  f.storage.setItem = set; const result = await engine.synchronize(); assert.equal(result.data.places[0].note, 'Não perder'); assert.equal(result.durable, true); assert.equal(result.pending, 0);
});

test('corrupt entry blocks sync without ignoring later valid edits or overwriting cache', async () => {
  const f = await setup(), engine = f.create(); await engine.synchronize(); f.storage.setItem(engine.prefix + crypto.randomUUID(), '{bad'); engine.capture(note(engine.current, 'Preservar'));
  await assert.rejects(engine.synchronize(), /ler todas/); assert.equal(engine.current.places[0].note, 'Preservar'); assert.equal(engine.pending().length, 1); assert.equal(engine.durable, false);
});

test('Google/GPS refresh creates no user-edit queue; transition retains edits isolated by account', async () => {
  const f = await setup(); let active = true; const engine = f.create(f.storage, initial(), () => active); await engine.synchronize();
  engine.capture({ ...engine.current, places: [{ ...engine.current.places[0], photo: 'https://photo.example.invalid', distance: '20 km', hours: '10–20' }] }); assert.equal(engine.pending().length, 0);
  engine.capture(note(engine.current, 'Privado')); active = false; await assert.rejects(engine.synchronize(), f.r.security.AccountChangedError); assert.equal(engine.pending().length, 1);
  const other = new (f.r.load('app/trip-guide/sync-engine.ts').SyncEngine)('B:other', f.storage, initial()); assert.equal(other.pending().length, 0);
});

test('queues above 100 edits are saved in acknowledged batches without dropping the tail', async () => {
  const f = await setup(), engine = f.create(); await engine.synchronize();
  for (let i = 0; i < 105; i++) engine.capture(note(engine.current, 'Nota ' + i));
  assert.equal(engine.pending().length, 105); const result = await engine.synchronize();
  assert.equal(result.data.places[0].note, 'Nota 104'); assert.equal(result.pending, 0);
  const puts = f.r.state.requests.filter((r) => r.method === 'PUT'); assert.equal(puts.length, 2);
  assert.deepEqual(await Promise.all(puts.map(async (r) => (await r.json()).mutationIds.length)), [100, 5]);
});

test('last retry-loop batch retains its acknowledged version, with or without remaining edits', async () => {
  for (const count of [800, 805]) {
    const f = await setup(), engine = f.create(); await engine.synchronize();
    for (let i = 1; i <= count; i++) engine.capture(note(engine.current, 'Nota ' + i));
    const result = await engine.synchronize(); assert.equal(result.data.places[0].note, 'Nota ' + count); assert.equal(result.pending, count - 800);
    assert.equal(JSON.parse(f.r.rows.get('A')).places[0].note, 'Nota 800');
    const final = await engine.synchronize(); assert.equal(final.pending, 0); assert.equal(final.data.places[0].note, 'Nota ' + count);
  }
});

test('legacy cache with unknown base needs explicit conflict choice before destructive differences', async () => {
  const f = await setup(note(initial(), 'Mais recente na nuvem'));
  f.r.security.accountStorage(f.storage, f.owner).setItem('roamly-maps', '["Madri"]');
  const engine = f.create(f.storage, initial()), result = await engine.synchronize();
  assert.ok(result.conflicts.length); assert.equal(JSON.parse(f.r.rows.get('A')).places[0].note, 'Mais recente na nuvem');
  assert.equal(f.r.state.requests.filter((r) => r.method === 'PUT').length, 0);
  engine.resolve('cloud'); assert.equal((await engine.synchronize()).data.places[0].note, 'Mais recente na nuvem');
});

test('share import retries a concurrent autosave and preserves existing private notes without duplicates', async () => {
  const f = await setup();
  await f.r.auth.createSessionCookie({ id: 'B', generation: 'gen-B', email: 'b@example.invalid', name: 'B' }, new Request('https://app.example.invalid/'));
  const gen = f.r.accounts.get('B'), shareId = crypto.randomUUID();
  f.r.rows.set('B', JSON.stringify({ maps: ['Roma'], currentMap: 'Roma', places: [{ ...place, id: 'b-place', placeId: 'ChIJImported', destination: 'Roma', note: 'Do not copy' }] }));
  f.r.sql.prepare('INSERT INTO map_shares (share_id, owner_user_id, owner_generation, map_name, invited_email, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(shareId, 'B', gen, 'Roma', 'a@example.invalid', 1);
  const challenge = await f.r.load('app/api/auth/challenge/route.ts').POST(new Request('https://app.example.invalid/api/auth/challenge', { method: 'POST', headers: { Origin: 'https://app.example.invalid', 'Content-Type': 'application/json' }, body: '{}' }));
  const token = (await challenge.json()).token; f.r.state.cookie += '; ' + challenge.headers.get('set-cookie').split(';')[0];
  // Inject the competing autosave after recipient read, before import CAS.
  const originalCommit = f.backend.commitItinerary; let raced = false;
  f.backend.commitItinerary = async (...args) => { if (!raced) { raced = true; await originalCommit(f.user, note(initial(), 'Minha nota concorrente'), 0, [crypto.randomUUID()]); } return originalCommit(...args); };
  const request = () => new Request('https://app.example.invalid/api/shares/import', { method: 'POST', headers: { Origin: 'https://app.example.invalid', 'Content-Type': 'application/json', Cookie: f.r.state.cookie, 'X-Roamly-CSRF': token, 'X-Roamly-Account': f.owner }, body: JSON.stringify({ shareId }) });
  const route = f.r.load('app/api/shares/import/route.ts');
  assert.equal((await route.POST(request())).status, 200);
  let data = JSON.parse(f.r.rows.get('A')); assert.deepEqual(data.maps, ['Madri', 'Roma']); assert.equal(data.places[0].note, 'Minha nota concorrente'); assert.equal(data.places[1].note, '');
  await route.POST(request()); data = JSON.parse(f.r.rows.get('A')); assert.equal(data.places.length, 2); assert.equal(data.places[0].note, 'Minha nota concorrente');
});
