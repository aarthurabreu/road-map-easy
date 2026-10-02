import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, memoryStorage } from './helpers/runtime.mjs';

const req = (path, headers = {}, body = {}, method = 'POST') => new Request('https://app.example.invalid' + path, { method, headers: { Origin: 'https://app.example.invalid', 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
const place = { id: 'p', placeId: 'google-place-1', destination: 'Roma', name: 'Museu', category: 'Museu', note: 'Nota privada', pinColor: '#123abc' };
async function session(r, id) {
  const cookie = (await r.auth.createSessionCookie({ id, email: id.toLowerCase() + '@example.invalid', name: id }, req('/'))).split(';')[0];
  const user = await r.auth.getSessionUser(req('/', { Cookie: cookie }, {}, 'GET'));
  return { cookie, user, identity: user.id + ':' + user.generation };
}

test('place schema rejects wrong types, non-finite coordinates, unsafe URLs and malformed attributions without coercion', () => {
  const r = runtime(), { parsePlace } = r.load('app/place-schema.ts');
  for (const field of ['id', 'placeId', 'name', 'category', 'address', 'hours', 'statusLabel', 'note', 'rating', 'destination', 'pinColor', 'photo', 'googleMapsURI']) {
    for (const value of [7, {}, [], null]) assert.equal(parsePlace({ ...place, [field]: value }, { strict: true }).place, null, field + ': ' + JSON.stringify(value));
  }
  for (const invalid of [{ lat: NaN }, { lat: 91 }, { lng: Infinity }, { lng: -181 }, { x: {} }, { status: 'maybe' }, { photo: 'javascript:alert(1)' }, { googleMapsURI: 'data:text/html,hello' }, { photoAttribution: { name: {}, url: 'https://example.invalid/' } }, { photoAttribution: { name: 'N', url: 'javascript:alert(1)' } }, { photoAttributions: [{ name: 'N', url: {} }] }]) assert.equal(parsePlace({ ...place, ...invalid }, { strict: true }).place, null);
  const valid = parsePlace({ placeId: 'p', photoAttribution: { name: 'Autor', url: 'https://example.invalid/' } }, { strict: true });
  assert.ok(valid.place); assert.equal(valid.place.category, 'Google Places'); assert.equal(valid.place.distance, '—');
});

test('invalid sync places cannot change itinerary, revision, receipts or invite permissions; partial valid places still save', async () => {
  const r = runtime(), owner = await session(r, 'A'), sync = r.load('app/api/sync/route.ts');
  const original = JSON.stringify({ maps: ['Roma'], currentMap: 'Roma', places: [place] });
  r.rows.set('A', original);
  r.sql.prepare('INSERT INTO map_shares (share_id,owner_user_id,owner_generation,map_name,invited_email,created_at) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(), 'A', owner.user.generation, 'Roma', 'b@example.invalid', 1);
  for (const invalid of [{ category: 7 }, { statusLabel: {} }, { name: [] }, { destination: {} }, { photoAttribution: { name: 'N', url: 'javascript:alert(1)' } }, { lat: 1000 }]) {
    const response = await sync.PUT(req('/api/sync', { Cookie: owner.cookie, 'X-Roamly-Account': owner.identity }, { maps: [], currentMap: '', places: [{ ...place, ...invalid }], baseRevision: 0, mutationIds: [crypto.randomUUID()] }, 'PUT'));
    assert.equal(response.status, 422); assert.equal(r.rows.get('A'), original); assert.equal(r.shares.size, 1);
    assert.equal(r.sql.prepare('SELECT revision FROM user_itineraries WHERE user_id = ?').get('A').revision, 0);
    assert.equal(r.sql.prepare('SELECT COUNT(*) AS count FROM itinerary_mutations').get().count, 0);
  }
  const valid = await sync.PUT(req('/api/sync', { Cookie: owner.cookie, 'X-Roamly-Account': owner.identity }, { maps: ['Roma'], currentMap: 'Roma', places: [{ placeId: 'p', destination: 'Roma' }], baseRevision: 0, mutationIds: [crypto.randomUUID()] }, 'PUT'));
  assert.equal(valid.status, 200); assert.equal(JSON.parse(r.rows.get('A')).places[0].placeId, 'p');
});

test('malformed shared places are hidden with an explicit warning and cannot poison an invited account; valid import remains private and deduplicated', async () => {
  const r = runtime(), a = await session(r, 'A'), b = await session(r, 'B');
  const shareId = crypto.randomUUID();
  r.sql.prepare('INSERT INTO map_shares (share_id,owner_user_id,owner_generation,map_name,invited_email,created_at) VALUES (?,?,?,?,?,?)').run(shareId, 'A', a.user.generation, 'Roma', 'b@example.invalid', 1);
  const challenge = await r.load('app/api/auth/challenge/route.ts').POST(req('/api/auth/challenge'));
  const token = (await challenge.json()).token;
  const headers = { Cookie: b.cookie + '; ' + challenge.headers.get('set-cookie').split(';')[0], 'X-Roamly-CSRF': token, 'X-Roamly-Account': b.identity };
  const importer = r.load('app/api/shares/import/route.ts');
  for (const invalid of [{ category: 7 }, { statusLabel: ['open'] }, { address: {} }, { photoAttribution: { name: [], url: 'https://example.invalid' } }]) {
    r.rows.set('A', JSON.stringify({ maps: ['Roma'], currentMap: 'Roma', places: [{ ...place, ...invalid }] }));
    const shared = await r.load('app/api/shares/route.ts').GET(req('/api/shares?shareId=' + shareId, { Cookie: b.cookie }, {}, 'GET'));
    const view = await shared.json(); assert.equal(view.map.places.length, 0); assert.equal(view.invalidCount, 1);
    const imported = await importer.POST(req('/api/shares/import', headers, { shareId }));
    assert.equal(imported.status, 422); assert.equal(r.rows.get('B'), undefined);
  }
  r.rows.set('A', JSON.stringify({ maps: ['Roma'], currentMap: 'Roma', places: [place] }));
  const validView = await (await r.load('app/api/shares/route.ts').GET(req('/api/shares?shareId=' + shareId, { Cookie: b.cookie }, {}, 'GET'))).json();
  assert.equal('note' in validView.map.places[0], false); assert.equal('distance' in validView.map.places[0], false);
  assert.equal((await importer.POST(req('/api/shares/import', headers, { shareId }))).status, 200);
  const saved = JSON.parse(r.rows.get('B')).places[0]; assert.equal(saved.note, ''); assert.equal(saved.pinColor, '#123abc');
  assert.doesNotThrow(() => r.load('app/trip-guide/google-places.ts').localizedCategory(saved.category, 'pt'));
  assert.doesNotThrow(() => r.load('app/trip-guide/google-places.ts').localizedStatusLabel(saved.statusLabel, 'pt'));
  assert.equal((await importer.POST(req('/api/shares/import', headers, { shareId }))).status, 200); assert.equal(JSON.parse(r.rows.get('B')).places.length, 1);
});

test('poisoned old cloud and local records recover safely while retaining valid notes, pin colors and opaque IDs', async () => {
  const r = runtime(), a = await session(r, 'A');
  r.rows.set('A', JSON.stringify({ maps: ['Roma', {}], currentMap: 'Roma', places: [{ ...place, category: {}, statusLabel: 7, lat: 1000 }, null] }));
  const cloud = await r.load('app/api/_lib/itinerary-revisions.ts').readItinerary(a.user);
  assert.ok(cloud.invalidCount); assert.equal(cloud.data.places.length, 1); assert.equal(cloud.data.places[0].category, 'Google Places'); assert.equal(cloud.data.places[0].note, place.note); assert.equal(cloud.data.places[0].pinColor, place.pinColor); assert.equal(cloud.data.places[0].lat, undefined);
  const storage = memoryStorage(); storage.setItem('roamly-maps', '["Roma"]'); storage.setItem('roamly-place-refs', JSON.stringify([{ ...place, category: [] }, {}])); storage.setItem('roamly-notes', '{"p":"Nota mais nova","evil":{}}');
  const restored = r.load('app/trip-guide/place-model.ts').restoreLocalItinerary(storage, false);
  assert.equal(restored.places.length, 1); assert.equal(restored.places[0].placeId, 'google-place-1'); assert.equal(restored.places[0].note, 'Nota mais nova'); assert.equal(restored.places[0].pinColor, '#123abc'); assert.equal(restored.places[0].category, 'Google Places');
});

test('review regressions: destination-scoped defaults, inherited dictionary keys and Google photo projection remain safe', () => {
  const r = runtime(), schema = r.load('app/place-schema.ts'), model = r.load('app/trip-guide/place-model.ts'), privacy = r.load('app/data-privacy.ts');
  const a = schema.parsePlace({ placeId: 'p', destination: 'Roma' }).place, b = schema.parsePlace({ placeId: 'p', destination: 'Madri' }).place;
  assert.notEqual(a.id, b.id);
  for (const id of ['__proto__', 'constructor', 'toString']) {
    const storage = memoryStorage(); storage.setItem('roamly-maps', '["Roma"]'); storage.setItem('roamly-place-refs', JSON.stringify([{ ...place, id, placeId: id }]));
    const restored = model.restoreLocalItinerary(storage, false).places[0]; assert.equal(restored.placeId, id); assert.equal(restored.note, place.note); assert.equal(typeof restored.note, 'string'); assert.equal(typeof model.placeKey(id, 'Roma'), 'string');
  }
  const projected = privacy.withoutDistance(schema.parsePlace({ ...place, photoSource: 'google', photo: 'https://example.invalid/expired-google-photo', photoAttributions: [{ name: 'Autor' }] }, { strict: true }).place);
  assert.equal(projected.photo, ''); assert.equal('photoAttributions' in projected, false);
  const recovered = schema.readSafeItinerary({ maps: ['Roma', 'Madri'], currentMap: 'Roma', places: [{ ...place }, { ...place, destination: 'Madri' }] });
  assert.notEqual(recovered.data.places[0].id, recovered.data.places[1].id); assert.equal(recovered.invalidCount, 1);
});

test('an old-generation snapshot cannot read a recreated account itinerary', async () => {
  const r = runtime(), a = await session(r, 'A');
  r.sql.prepare('UPDATE user_accounts SET generation = ? WHERE user_id = ?').run('new-generation', 'A');
  r.rows.set('A', JSON.stringify({ maps: ['New private'], currentMap: 'New private', places: [] }));
  const read = await r.load('app/api/_lib/itinerary-revisions.ts').readItinerary(a.user); assert.equal(read.data, null);
});

test('unreadable storage permits cloud viewing and volatile editing but never writes or acknowledges an unknown queue', async () => {
  const r = runtime(), a = await session(r, 'A'); r.state.cookie = a.cookie;
  r.rows.set('A', JSON.stringify({ maps: ['Roma'], currentMap: 'Roma', places: [place] }));
  const blocked = { get length() { throw new Error('Blocked'); }, key() { throw new Error('Blocked'); }, getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); }, removeItem() { throw new Error('Blocked'); } };
  const engine = new (r.load('app/trip-guide/sync-engine.ts').SyncEngine)(a.identity, blocked, { maps: [], currentMap: '', places: [] });
  let result = await engine.synchronize(); assert.equal(result.readOnly, true); assert.equal(result.data.places[0].name, 'Museu'); assert.equal(result.durable, false);
  engine.capture({ ...result.data, places: [{ ...result.data.places[0], note: 'Volatile note' }] });
  result = await engine.synchronize(); assert.equal(result.data.places[0].note, 'Volatile note'); assert.equal(result.pending, 1); assert.equal(r.state.requests.filter((request) => request.method === 'PUT').length, 0); assert.equal(JSON.parse(r.rows.get('A')).places[0].note, place.note);
});
