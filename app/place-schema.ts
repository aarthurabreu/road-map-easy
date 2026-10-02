import type { Place } from './trip-guide/types';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit: number, nonempty = false): value is string => typeof value === 'string' && value.length <= limit && (!nonempty || value.trim().length > 0);
const webUrl = (value: unknown): value is string => {
  if (!text(value, 8192)) return false;
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
};

// One trust boundary for API writes, shared data, cloud reads and browser caches.
// Missing optional metadata is supported; an explicitly invalid field is never
// coerced into a string. Old reads can recover sound identity/user-intent fields.
export function parsePlace(value: unknown, options: { strict?: boolean; destination?: string; index?: number } = {}): { place: Place | null; issues: string[] } {
  if (!record(value) || !text(value.placeId, 512, true)) return { place: null, issues: ['placeId'] };
  const issues: string[] = [];
  const destination = text(value.destination, 120, true) ? value.destination : options.destination ?? 'Madri';
  const defaults: Record<string, unknown> = { id: value.placeId + '-' + destination, name: 'Carregando lugar…', category: 'Google Places', address: '', hours: 'Consultando horários', status: 'closed', statusLabel: 'Atualizando', note: '', photo: '', rating: '—', x: 45 + (options.index ?? 0) % 10 * 4, y: 45 + (options.index ?? 0) % 10 * 3, destination };
  const copy: Record<string, unknown> = { placeId: value.placeId, ...defaults };
  const lengths: Record<string, number> = { id: 700, name: 500, category: 500, address: 2000, hours: 1000, statusLabel: 500, note: 20_000, rating: 40, destination: 120, pinColor: 64 };
  for (const [key, limit] of Object.entries(lengths)) {
    if (value[key] === undefined) continue;
    if (text(value[key], limit, key === 'id' || key === 'destination')) copy[key] = value[key]; else issues.push(key);
  }
  if (value.status !== undefined) {
    if (value.status === 'open' || value.status === 'soon' || value.status === 'closed') copy.status = value.status; else issues.push('status');
  }
  for (const [key, min, max] of [['x', -10000, 10000], ['y', -10000, 10000], ['lat', -90, 90], ['lng', -180, 180]] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= min && value[key] <= max) copy[key] = value[key]; else issues.push(key);
  }
  for (const key of ['photo', 'googleMapsURI']) {
    if (value[key] === undefined) continue;
    if (webUrl(value[key])) copy[key] = value[key]; else issues.push(key);
  }
  const attribution = (item: unknown) => record(item) && text(item.name, 500) && (item.url === undefined || webUrl(item.url)) ? { name: item.name, url: item.url ?? '' } : null;
  if (value.photoAttribution !== undefined) {
    const author = attribution(value.photoAttribution);
    if (author) copy.photoAttribution = author; else issues.push('photoAttribution');
  }
  if (value.photoAttributions !== undefined) {
    if (Array.isArray(value.photoAttributions) && value.photoAttributions.length <= 32 && value.photoAttributions.every((item) => attribution(item))) copy.photoAttributions = value.photoAttributions.map(attribution);
    else issues.push('photoAttributions');
  }
  if (value.photoSource !== undefined) {
    if (value.photoSource === 'google') copy.photoSource = 'google'; else issues.push('photoSource');
  }
  return { place: options.strict && issues.length ? null : { ...copy, distance: '—' } as Place, issues };
}

export function readSafeItinerary(value: unknown) {
  if (!record(value)) return { data: { maps: [] as string[], currentMap: '', places: [] as Place[] }, invalidCount: value == null ? 0 : 1 };
  const rawMaps = Array.isArray(value.maps) ? value.maps : [];
  const maps = [...new Set(rawMaps.filter((map): map is string => text(map, 120, true)))].slice(0, 100);
  const currentMap = typeof value.currentMap === 'string' && maps.includes(value.currentMap) ? value.currentMap : maps[0] ?? '';
  let invalidCount = rawMaps.length - maps.length + (Array.isArray(value.places) ? 0 : 1);
  const ids = new Set<string>();
  const places = (Array.isArray(value.places) ? value.places : []).flatMap((item, index) => {
    const parsed = parsePlace(item, { index });
    if (!parsed.place || parsed.issues.length) invalidCount++;
    if (!parsed.place) return [];
    if (ids.has(parsed.place.id)) { invalidCount++; parsed.place.id = `${parsed.place.placeId}-${parsed.place.destination}-${index}`; }
    ids.add(parsed.place.id);
    return [parsed.place];
  });
  return { data: { maps, currentMap, places }, invalidCount };
}
