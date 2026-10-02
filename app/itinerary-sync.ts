import type { Place } from './trip-guide/types';
import { placeKey } from './trip-guide/place-model';
import { withoutDistance } from './data-privacy';
import { readSafeItinerary } from './place-schema';

export type Itinerary = { maps: string[]; currentMap: string; places: Place[] };
export type PendingOperation = {
  id: string; createdAt: number; kind: 'map' | 'place' | 'field' | 'current';
  map: string; key?: string; field?: 'note' | 'pinColor'; before: unknown; after: unknown; place?: Place;
};
export type SyncConflict = { operation: PendingOperation; cloud: unknown };
export const emptyItinerary = (): Itinerary => ({ maps: [], currentMap: '', places: [] });
const value = (input: unknown): unknown => input === undefined ? null : input;
function canonical(input: unknown): string {
  if (input === undefined) return 'null';
  if (input === null || typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return '[' + input.map(canonical).join(',') + ']';
  return '{' + Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
}
export const sameValue = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export const keyFor = (place: Place) => placeKey(place.placeId, place.destination ?? 'Madri');
const intent = (place: Place) => ({ key: keyFor(place), note: place.note ?? '', pinColor: place.pinColor ?? null });
const mapIntent = (data: Itinerary, map: string) => data.maps.includes(map)
  ? data.places.filter((place) => (place.destination ?? 'Madri') === map).map(intent).sort((a, b) => a.key.localeCompare(b.key)) : null;

export function cleanItinerary(data: Itinerary): Itinerary {
  const safe = readSafeItinerary(data).data;
  return { ...safe, places: safe.places.map(withoutDistance) as Place[] };
}

// Only user intent is queued. GPS distances and Google hydration are not edits.
export function itineraryOperations(before: Itinerary, after: Itinerary): PendingOperation[] {
  const result: PendingOperation[] = [];
  const append = (operation: Omit<PendingOperation, 'id' | 'createdAt'>) => result.push({ ...operation, id: crypto.randomUUID(), createdAt: Date.now() });
  for (const map of after.maps) if (!before.maps.includes(map)) append({ kind: 'map', map, before: null, after: [] });
  for (const map of before.maps) if (!after.maps.includes(map)) append({ kind: 'map', map, before: mapIntent(before, map), after: null });
  const previous = new Map(before.places.map((place) => [keyFor(place), place]));
  const next = new Map(after.places.map((place) => [keyFor(place), place]));
  for (const [key, place] of next) {
    const old = previous.get(key);
    if (!old) append({ kind: 'place', map: place.destination ?? 'Madri', key, before: null, after: withoutDistance(place) });
    else for (const field of ['note', 'pinColor'] as const) if (!sameValue(old[field], place[field])) {
      append({ kind: 'field', map: place.destination ?? 'Madri', key, field, before: value(old[field]), after: value(place[field]), place: withoutDistance(place) as Place });
    }
  }
  for (const [key, place] of previous) if (!next.has(key) && after.maps.includes(place.destination ?? 'Madri')) {
    append({ kind: 'place', map: place.destination ?? 'Madri', key, before: intent(place), after: null });
  }
  if (before.currentMap !== after.currentMap) append({ kind: 'current', map: after.currentMap, before: before.currentMap, after: after.currentMap });
  return result;
}

export function reconcileItinerary(cloud: Itinerary, operations: PendingOperation[], force = false) {
  const data = cleanItinerary(structuredClone(cloud));
  const conflicts: SyncConflict[] = [];
  for (const operation of operations) {
    const index = operation.key ? data.places.findIndex((place) => keyFor(place) === operation.key) : -1;
    const currentPlace = data.places[index];
    const current = operation.kind === 'map' ? mapIntent(data, operation.map)
      : operation.kind === 'place' ? (currentPlace ? intent(currentPlace) : null)
      : operation.kind === 'field' ? (currentPlace ? value(currentPlace[operation.field!]) : null) : data.currentMap;
    const expected = operation.kind === 'place' && operation.after !== null ? intent(operation.after as Place) : operation.after;
    const missingParent = (operation.kind === 'field' || (operation.kind === 'place' && operation.after !== null)) && !data.maps.includes(operation.map);
    const matches = operation.kind === 'current' || (operation.kind === 'map' && operation.before === null && current !== null)
      || (!missingParent && !(operation.kind === 'field' && !currentPlace) && (sameValue(current, operation.before) || sameValue(current, expected)));
    if (!matches && !force) { conflicts.push({ operation, cloud: current }); continue; }
    if (operation.kind === 'map') {
      if (operation.after === null) { data.maps = data.maps.filter((map) => map !== operation.map); data.places = data.places.filter((place) => (place.destination ?? 'Madri') !== operation.map); }
      else if (!data.maps.includes(operation.map)) data.maps.push(operation.map);
    } else if (operation.kind === 'place') {
      if (operation.after === null) { if (index >= 0) data.places.splice(index, 1); }
      else {
        if (!data.maps.includes(operation.map)) data.maps.push(operation.map);
        if (index >= 0) data.places[index] = operation.after as Place; else data.places.push(operation.after as Place);
      }
    } else if (operation.kind === 'field') {
      if (!data.maps.includes(operation.map)) data.maps.push(operation.map);
      const target = currentPlace ?? { ...operation.place! };
      if (operation.after === null) delete target[operation.field!];
      else target[operation.field!] = operation.after as string;
      if (!currentPlace) data.places.push(target);
    } else if (data.maps.includes(operation.map)) data.currentMap = operation.map;
  }
  return { data: cleanItinerary(data), conflicts };
}
