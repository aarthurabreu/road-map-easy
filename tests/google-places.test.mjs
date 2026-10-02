import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime } from './helpers/runtime.mjs';

test('modern and legacy schedules handle 24h every day, split shifts, exact boundaries and next opening', () => {
  const r = runtime(), g = r.load('app/trip-guide/google-places.ts');
  const everyDay = { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] };
  const modern = g.liveSchedule(everyDay, 0);
  const legacy = g.legacySchedule({ periods: [{ open: { day: 0, hours: 0, minutes: 0 } }] }, 0);
  for (let day = 0; day < 7; day++) for (const language of ['pt', 'es', 'en']) {
    const time = Date.parse('2026-09-27T23:30:00Z') + day * 86400000;
    const a = g.calculateSchedule(modern, language, time), b = g.calculateSchedule(legacy, language, time);
    assert.equal(a.status, 'open'); assert.equal(a.hours, '24h'); assert.equal(JSON.stringify(a), JSON.stringify(b));
  }
  const split = g.liveSchedule({ periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 12, minute: 0 } }, { open: { day: 1, hour: 17, minute: 0 }, close: { day: 1, hour: 22, minute: 0 } }] }, 0);
  let result = g.calculateSchedule(split, 'pt', Date.parse('2026-09-28T17:30:00Z'));
  assert.equal(result.hours, '09:00 – 12:00, 17:00 – 22:00'); assert.equal(result.status, 'open');
  result = g.calculateSchedule(split, 'pt', Date.parse('2026-09-28T12:00:00Z')); assert.equal(result.status, 'closed'); assert.equal(result.label, 'Abre às 17:00');
  assert.equal(g.calculateSchedule(split, 'pt', Date.parse('2026-09-28T16:30:00Z')).label, 'Abre em 30 min');
  assert.equal(g.calculateSchedule(split, 'pt', Date.parse('2026-09-28T22:00:00Z')).status, 'closed');
});

test('overnight week wrap, adjacent shifts, timezone and missing opening hours are calculated without API requests', () => {
  const r = runtime(), g = r.load('app/trip-guide/google-places.ts');
  const overnight = g.liveSchedule({ periods: [{ open: { day: 6, hour: 22, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } }] }, 0);
  const sunday = g.calculateSchedule(overnight, 'pt', Date.parse('2026-09-27T01:00:00Z'));
  assert.equal(sunday.hours, '00:00 – 02:00'); assert.equal(sunday.label, 'Fecha em 60 min');
  const adjacent = g.liveSchedule({ periods: [{ open: { day: 5, hour: 9, minute: 0 }, close: { day: 5, hour: 12, minute: 0 } }, { open: { day: 5, hour: 12, minute: 0 }, close: { day: 5, hour: 17, minute: 0 } }] }, 330);
  const friday = g.calculateSchedule(adjacent, 'en', Date.parse('2026-10-02T06:00:00Z'));
  assert.equal(friday.status, 'open'); assert.equal(friday.hours, '09:00 – 17:00');
  assert.equal(g.calculateSchedule(g.liveSchedule(undefined, 0), 'pt').label, 'Horário não informado');
});

test('provider hydration coalesces in-flight details, limits concurrency, selects first photo with all credits and does not persist its URI', async () => {
  const r = runtime(), g = r.load('app/trip-guide/google-places.ts');
  let active = 0, peak = 0, calls = 0;
  class FakePlace {
    constructor({ id }) { this.id = id; this.displayName = 'Museu'; this.photos = [{ getURI: () => 'https://example.invalid/first', authorAttributions: [{ displayName: 'A', uri: 'https://example.invalid/a' }, { displayName: 'B', uri: 'https://example.invalid/b' }] }, { getURI: () => 'https://example.invalid/second' }]; }
    async fetchFields() { calls++; active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active--; }
  }
  const saved = { id: 'saved', placeId: 'p', destination: 'Roma', note: 'Private' };
  const results = await Promise.all([g.hydrateModernPlace(FakePlace, saved, null, 'pt'), g.hydrateModernPlace(FakePlace, { ...saved, id: 'other', note: 'Other' }, null, 'pt'), ...Array.from({ length: 8 }, (_, i) => g.hydrateModernPlace(FakePlace, { ...saved, placeId: 'p' + i }, null, 'pt'))]);
  assert.equal(calls, 9); assert.ok(peak <= 4); assert.equal(results[0].photo, 'https://example.invalid/first'); assert.equal(results[0].photoAttributions.length, 2); assert.equal(results[1].note, 'Other'); assert.equal(results[1].id, 'other');
  const stored = r.load('app/data-privacy.ts').withoutDistance(results[0]); assert.equal(stored.photo, ''); assert.equal('photoAttributions' in stored, false); assert.equal('openingSchedule' in stored, false); assert.equal(stored.placeId, 'p'); assert.equal(stored.note, 'Private');
  await g.hydrateModernPlace(FakePlace, saved, null, 'pt'); assert.equal(calls, 10, 'Completed provider results are not durably cached');
});

test('transient errors retry once, quota is not retried automatically and a later explicit retry is possible', async () => {
  const r = runtime(), g = r.load('app/trip-guide/google-places.ts'); r.context.setTimeout = (fn) => setTimeout(fn, 1);
  let attempts = 0, quota = false;
  class FakePlace {
    constructor({ id }) { this.id = id; }
    async fetchFields() { attempts++; if (quota) throw new Error('RESOURCE_EXHAUSTED: quota exceeded'); if (attempts === 1) throw new Error('Failed to fetch'); }
  }
  const place = { id: 'p', placeId: 'p', destination: 'Roma', note: '' };
  await g.hydrateModernPlace(FakePlace, place, null, 'pt'); assert.equal(attempts, 2);
  quota = true; await assert.rejects(g.hydrateModernPlace(FakePlace, place, null, 'pt'), /quota/); assert.equal(attempts, 3);
  quota = false; await g.hydrateModernPlace(FakePlace, place, null, 'pt'); assert.equal(attempts, 4);
});
