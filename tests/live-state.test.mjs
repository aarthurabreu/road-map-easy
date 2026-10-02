import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime } from './helpers/runtime.mjs';

test('business closure overrides modern/legacy 24h hours in all languages', () => {
  const g = runtime().load('app/trip-guide/google-places.ts');
  for (const status of ['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY', 'FUTURE_OPENING']) for (const language of ['pt', 'es', 'en']) {
    const modern = g.toSavedPlace({ id: 'p', businessStatus: status, currentOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] } }, 'Test', '', 'p', null, language);
    const legacy = g.toSavedLegacyPlace({ place_id: 'p', business_status: status, opening_hours: { periods: [{ open: { day: 0, hours: 0, minutes: 0 } }] } }, 'Test', '', 'p', null, language);
    assert.equal(modern.status, 'closed'); assert.equal(legacy.status, 'closed');
    assert.equal(g.placeAvailability(modern, language).status, 'closed');
  }
  assert.ok(g.placeFields.includes('businessStatus'));
});

test('availability is unconfirmed offline, without live data, after TTL or local midnight', () => {
  const g = runtime().load('app/trip-guide/google-places.ts');
  const now = Date.parse('2026-10-02T23:55:00Z');
  const schedule = { utcOffsetMinutes: 0, fetchedAt: now, periods: [{ start: 0, end: 10080, alwaysOpen: true }] };
  const place = { status: 'open', statusLabel: 'Aberto agora', openingSchedule: schedule };
  assert.equal(g.placeAvailability(place, 'pt', now, true).status, 'open');
  for (const result of [g.placeAvailability(place, 'pt', now, false), g.placeAvailability({ ...place, openingSchedule: undefined }, 'pt', now), g.placeAvailability(place, 'pt', now + g.detailsLifetimeMs), g.placeAvailability(place, 'pt', now + 6 * 60_000)]) {
    assert.equal(result.status, 'closed'); assert.equal(result.label, 'Horário não confirmado');
  }
});

test('GPS requires recent valid coordinates, including a stationary renewed fix', () => {
  const g = runtime().load('app/trip-guide/location-state.ts');
  const now = Date.now(); const fix = { timestamp: now, coords: { latitude: -27, longitude: -48 } };
  assert.equal(g.freshLocation(fix, now), true);
  assert.equal(g.freshLocation(fix, now + g.locationLifetimeMs + 1), false);
  assert.equal(g.freshLocation({ ...fix, timestamp: now + g.locationLifetimeMs }, now + g.locationLifetimeMs), true);
  assert.equal(g.freshLocation({ ...fix, coords: { latitude: NaN, longitude: 200 } }, now), false);
  assert.equal(g.freshLocation({ ...fix, timestamp: now + 6000 }, now), false);
});
