import type { Place, PlaceStatus } from './types';
import type { ItineraryStorage } from '../account-storage';
import { readSafeItinerary } from '../place-schema';

export const initialPlaces: Place[] = [
  {
    id: 'palacio', placeId: 'ChIJwamkfX4oQg0RUUjO1nnsfy4', name: 'Palácio Real de Madri',
    category: 'História & cultura', address: 'C. de Bailén, s/n, Centro, Madrid',
    hours: '10:00 – 19:00', status: 'open', statusLabel: 'Aberto agora', distance: '1,2 km',
    note: 'Comprar ingresso antecipado',
    photo: 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?auto=format&fit=crop&w=1200&q=85',
    x: 25, y: 34, rating: '4,7', lat: 40.417955, lng: -3.714312,
  },
  {
    id: 'prado', placeId: 'ChIJ7aLYZp0oQg0RWoitk33wlBA', name: 'Museu do Prado',
    category: 'Museu', address: 'C. de Ruiz de Alarcón, 23, Retiro, Madrid',
    hours: '10:00 – 20:00', status: 'soon', statusLabel: 'Fecha em 45 min', distance: '850 m',
    note: 'Ver a ala de Goya primeiro',
    photo: 'https://images.unsplash.com/photo-1543783207-ec64e4d95325?auto=format&fit=crop&w=1200&q=85',
    x: 64, y: 49, rating: '4,8', lat: 40.413782, lng: -3.692127,
  },
  {
    id: 'retiro', placeId: 'ChIJe4IR9Z8oQg0RrqMktRYnbJ4', name: 'Parque El Retiro',
    category: 'Parque', address: 'Plaza de la Independencia, 7, Madrid',
    hours: '06:00 – 00:00', status: 'open', statusLabel: 'Aberto agora', distance: '1,6 km',
    note: 'Alugar um barco no lago',
    photo: 'https://images.unsplash.com/photo-1548919973-5cef591cdbc9?auto=format&fit=crop&w=1200&q=85',
    x: 78, y: 29, rating: '4,8', lat: 40.41526, lng: -3.68454,
  },
  {
    id: 'botin', placeId: 'ChIJ5W0gy3goQg0RztECvkbsm30', name: 'Sobrino de Botín',
    category: 'Restaurante', address: 'C. de Cuchilleros, 17, Centro, Madrid',
    hours: '13:00 – 16:00, 20:00 – 00:00', status: 'closed', statusLabel: 'Abre às 20:00', distance: '950 m',
    note: 'Pedir o cochinillo assado',
    photo: 'https://images.unsplash.com/photo-1515443961218-a51367888e4b?auto=format&fit=crop&w=1200&q=85',
    x: 39, y: 68, rating: '4,3', lat: 40.414236, lng: -3.708073,
  },
];

export const statusPinColors: Record<PlaceStatus, string> = { open: '#1f7a50', soon: '#e1a43a', closed: '#9a7068' };

export const pinColorChoices = [
  { color: '#1f7a50', label: 'green' as const }, { color: '#e1a43a', label: 'yellow' as const },
  { color: '#d65c52', label: 'red' as const }, { color: '#2f80da', label: 'blue' as const },
  { color: '#7b61a8', label: 'purple' as const },
];

export const removedPlacesStorageKey = 'roamly-removed-place-keys';

export const legacyPlaceIds: Record<string, string> = {
  ChIJpy0369sQQg0R2lMStY3WFgw: 'ChIJwamkfX4oQg0RUUjO1nnsfy4',
  ChIJv_4a4ZYoQg0R2DJ8JCQx3jk: 'ChIJe4IR9Z8oQg0RrqMktRYnbJ4',
  ChIJW7dQGYYoQg0Rql2PUtWg3xw: 'ChIJ5W0gy3goQg0RztECvkbsm30',
};

export function placeKey(placeId: string, destination = 'Madri') {
  return `${Object.hasOwn(legacyPlaceIds, placeId) ? legacyPlaceIds[placeId] : placeId}:${destination.trim().toLocaleLowerCase('pt-BR')}`;
}

export function dedupePlaces(items: Place[]) {
  const seen = new Set<string>();
  return items.filter((place) => {
    const key = placeKey(place.placeId, place.destination ?? 'Madri');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function restoreLocalItinerary(storage: ItineraryStorage, guest: boolean): { maps: string[]; currentMap: string; places: Place[] } {
  const fallback = { maps: guest ? ['Madri'] : [], currentMap: guest ? 'Madri' : '', places: guest ? initialPlaces : [] };
  try {
    const savedMaps = JSON.parse(storage.getItem('roamly-maps') ?? 'null') as string[] | null;
    const maps = Array.isArray(savedMaps) ? Array.from(new Set(savedMaps.filter((map) => typeof map === 'string' && map.trim() && map.length <= 120))).slice(0, 100) : fallback.maps;
    const savedCurrent = storage.getItem('roamly-current-map');
    const currentMap = savedCurrent && maps.includes(savedCurrent) ? savedCurrent : maps[0] ?? '';
    const rawNotes = JSON.parse(storage.getItem('roamly-notes') ?? '{}');
    const notes: Record<string, string> = rawNotes && typeof rawNotes === 'object' && !Array.isArray(rawNotes) ? Object.fromEntries(Object.entries(rawNotes).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length <= 20_000)) : {};
    const rawRefs = JSON.parse(storage.getItem('roamly-place-refs') ?? '[]');
    const refs = readSafeItinerary({ maps, currentMap, places: Array.isArray(rawRefs) ? rawRefs : [] }).data.places;
    const rawRemoved = JSON.parse(storage.getItem(removedPlacesStorageKey) ?? '[]');
    const removed = new Set((Array.isArray(rawRemoved) ? rawRemoved : []).filter((key): key is string => typeof key === 'string').map((key) => {
      const separator = key.indexOf(':');
      const id = key.slice(0, separator);
      return separator < 0 ? key : `${Object.hasOwn(legacyPlaceIds, id) ? legacyPlaceIds[id] : id}${key.slice(separator)}`;
    }));
    const byKey = new Map(refs.map((ref) => [placeKey(ref.placeId, ref.destination), ref]));
    const seeds = fallback.places.map((place) => {
      const saved = byKey.get(placeKey(place.placeId, place.destination ?? 'Madri'));
      return { ...place, ...saved, id: place.id, placeId: place.placeId, destination: place.destination,
        note: (Object.hasOwn(notes, place.id) ? notes[place.id] : undefined) ?? saved?.note ?? place.note, photo: saved?.photo || place.photo };
    });
    const known = new Set(seeds.map((place) => placeKey(place.placeId, place.destination ?? 'Madri')));
    const restored: Place[] = refs.filter((ref) => !known.has(placeKey(ref.placeId, ref.destination))).map((ref, index) => ({
      ...ref, id: ref.id, placeId: Object.hasOwn(legacyPlaceIds, ref.placeId) ? legacyPlaceIds[ref.placeId] : ref.placeId, destination: ref.destination,
      note: (Object.hasOwn(notes, ref.id) ? notes[ref.id] : undefined) ?? ref.note ?? '', name: ref.name ?? 'Carregando lugar…', category: ref.category ?? 'Google Places',
      address: ref.address ?? '', hours: ref.hours ?? 'Consultando horários', status: ref.status ?? 'closed',
      statusLabel: ref.statusLabel ?? 'Atualizando', distance: ref.distance ?? '—', photo: ref.photo ?? '',
      x: ref.x ?? 45 + index * 4, y: ref.y ?? 45 + index * 3, rating: ref.rating ?? '—',
    }));
    return { maps, currentMap, places: dedupePlaces([...seeds, ...restored]).filter((place) =>
      maps.includes(place.destination ?? 'Madri') && !removed.has(placeKey(place.placeId, place.destination ?? 'Madri'))).map((place) => ({ ...place, distance: '—' })) };
  } catch { return fallback; }
}

export function getPinColor(place: Place) { return place.pinColor || statusPinColors[place.status]; }
