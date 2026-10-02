import { languageLocales, translations, type Language } from '../i18n';
import type { Place, PlaceStatus, SearchPrediction } from './types';

export const placeFields = [
  'id', 'displayName', 'formattedAddress', 'location', 'primaryType', 'primaryTypeDisplayName',
  'rating', 'photos', 'currentOpeningHours', 'regularOpeningHours', 'utcOffsetMinutes', 'googleMapsURI',
];

const inFlight = new Map<string, Promise<google.maps.places.Place>>();
const legacyInFlight = new Map<string, Promise<google.maps.places.PlaceResult>>();
let activeRequests = 0;
const waiting: (() => void)[] = [];
async function limited<T>(request: () => Promise<T>): Promise<T> {
  if (activeRequests >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
  else activeRequests++;
  try {
    try { return await request(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/UNKNOWN_ERROR|NETWORK_ERROR|network|Failed to fetch|timeout|timed out|503|502/i.test(message) || /quota|RESOURCE_EXHAUSTED|REQUEST_DENIED|NOT_FOUND|429/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600));
      return await request();
    }
  } finally { const next = waiting.shift(); if (next) next(); else activeRequests--; }
}
function modernDetails(key: string, factory: () => google.maps.places.Place) {
  let pending = inFlight.get(key);
  if (!pending) {
    pending = limited(async () => { const place = factory(); await place.fetchFields({ fields: placeFields }); return place; }).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

export async function hydrateModernPlace(ModernPlace: typeof google.maps.places.Place, savedPlace: Place, userPosition: google.maps.LatLngLiteral | null, language: Language) {
  const livePlace = await modernDetails(savedPlace.placeId + ':' + language, () => new ModernPlace({ id: savedPlace.placeId, requestedLanguage: languageLocales[language] }));
  return toSavedPlace(livePlace, savedPlace.destination ?? 'Madri', savedPlace.note, savedPlace.id, userPosition, language);
}

export async function hydrateModernPlaceFromPrediction(prediction: google.maps.places.PlacePrediction, destination: string, userPosition: google.maps.LatLngLiteral | null, language: Language) {
  const livePlace = await modernDetails(prediction.placeId + ':' + language, () => prediction.toPlace());
  return toSavedPlace(livePlace, destination, '', `${livePlace.id}-${destination}`, userPosition, language);
}

export async function hydratePlaceById(savedPlace: Place, userPosition: google.maps.LatLngLiteral | null, language: Language) {
  const ModernPlace = (google.maps.places as unknown as { Place?: typeof google.maps.places.Place }).Place;
  if (ModernPlace) {
    return hydrateModernPlace(ModernPlace, savedPlace, userPosition, language);
  }
  return toSavedLegacyPlace(await fetchLegacyPlaceDetails(savedPlace.placeId), savedPlace.destination ?? 'Madri', savedPlace.note, savedPlace.id, userPosition, language);
}

export async function hydratePrediction(prediction: SearchPrediction, destination: string, userPosition: google.maps.LatLngLiteral | null, language: Language) {
  if (prediction.modern) {
    return hydrateModernPlaceFromPrediction(prediction.modern, destination, userPosition, language);
  }
  return toSavedLegacyPlace(await fetchLegacyPlaceDetails(prediction.placeId), destination, '', `${prediction.placeId}-${destination}`, userPosition, language);
}

export function fetchLegacyPlaceDetails(placeId: string) {
  let pending = legacyInFlight.get(placeId);
  if (pending) return pending;
  pending = limited(() => new Promise<google.maps.places.PlaceResult>((resolve, reject) => {
    const service = new google.maps.places.PlacesService(document.createElement('div'));
    service.getDetails({
      placeId,
      fields: ['place_id', 'name', 'formatted_address', 'geometry', 'opening_hours', 'photos', 'rating', 'types', 'utc_offset_minutes', 'url', 'business_status'],
    }, (result, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && result) resolve(result);
      else reject(new Error(`${status}: O Google Places não conseguiu carregar os dados deste lugar.`));
    });
  })).finally(() => legacyInFlight.delete(placeId));
  legacyInFlight.set(placeId, pending);
  return pending;
}

export function toSavedLegacyPlace(result: google.maps.places.PlaceResult, destination: string, note: string, id: string, userPosition: google.maps.LatLngLiteral | null, language: Language): Place {
  const location = result.geometry?.location?.toJSON();
  const schedule = getLegacySchedule(result.opening_hours, result.utc_offset_minutes ?? 0, language);
  const photo = result.photos?.[0];
  const attribution = parseLegacyAttribution(photo?.html_attributions?.[0]);
  return {
    id, placeId: result.place_id || id, destination, note,
    name: result.name || unnamedPlace(language), category: formatPlaceType(result.types?.[0], language),
    address: result.formatted_address || missingAddress(language),
    hours: schedule.hours, status: schedule.status, statusLabel: schedule.label,
    distance: location && userPosition ? formatDistance(haversineMeters(userPosition, location), language) : '—',
    photo: photo?.getUrl({ maxWidth: 1200, maxHeight: 800 }) || '', photoAttribution: attribution,
    photoAttributions: (photo?.html_attributions ?? []).map(parseLegacyAttribution).filter((author): author is NonNullable<typeof author> => Boolean(author)), photoSource: 'google',
    openingSchedule: legacySchedule(result.opening_hours, result.utc_offset_minutes ?? 0),
    x: 50, y: 50, rating: result.rating?.toLocaleString(languageLocales[language], { minimumFractionDigits: 1, maximumFractionDigits: 1 }) || '—',
    lat: location?.lat, lng: location?.lng, googleMapsURI: result.url,
  };
}

type Schedule = NonNullable<Place['openingSchedule']>;
type SchedulePoint = { day: number; hour: number; minute: number };
function normalizedSchedule(periods: { open: SchedulePoint; close?: SchedulePoint | null }[], utcOffsetMinutes: number): Schedule {
  return { utcOffsetMinutes, fetchedAt: Date.now(), periods: periods.map(({ open, close }) => {
    const start = open.day * 1440 + open.hour * 60 + open.minute;
    const alwaysOpen = !close && start === 0;
    let end = close ? close.day * 1440 + close.hour * 60 + close.minute : start + 10080;
    if (end <= start) end += 10080;
    return { start, end, alwaysOpen };
  }) };
}

export function calculateSchedule(schedule: Schedule, language: Language, now = Date.now()): { status: PlaceStatus; label: string; hours: string } {
  if (!schedule.periods.length) return unavailableSchedule(language);
  if (schedule.periods.some((period) => period.alwaysOpen)) return { status: 'open', label: openNow(language), hours: '24h' };
  const local = new Date(now + schedule.utcOffsetMinutes * 60_000);
  const dayStart = local.getUTCDay() * 1440;
  const minute = dayStart + local.getUTCHours() * 60 + local.getUTCMinutes();
  const week = 10080;
  const intervals = schedule.periods.flatMap((period) => [-week, 0, week].map((offset) => ({ start: period.start + offset, end: period.end + offset }))).sort((a, b) => a.start - b.start);
  // Merge touching/overlapping intervals so a shift change is not a closure.
  const merged: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  const clock = (minuteOfWeek: number) => { const minuteOfDay = (minuteOfWeek % 1440 + 1440) % 1440; return formatClock(Math.floor(minuteOfDay / 60), minuteOfDay % 60); };
  const daily = merged.filter((period) => period.start < dayStart + 1440 && period.end > dayStart);
  const hours = daily.length ? daily.map((period) => {
    const start = Math.max(period.start, dayStart); const end = Math.min(period.end, dayStart + 1440);
    return start === dayStart && end === dayStart + 1440 ? '24h' : `${clock(start)} – ${end === dayStart + 1440 ? '00:00' : clock(end)}`;
  }).join(', ') : closedToday(language);
  const current = merged.find((period) => period.start <= minute && minute < period.end);
  if (current) {
    const remaining = current.end - minute;
    return remaining <= 60 ? { status: 'soon', label: closesIn(remaining, language), hours } : { status: 'open', label: openNow(language), hours };
  }
  const next = merged.find((period) => period.start > minute);
  if (!next) return { status: 'closed', label: translations[language].closedStatus, hours };
  const wait = next.start - minute;
  return wait <= 60 ? { status: 'soon', label: opensIn(wait, language), hours } : { status: 'closed', label: opensAt(clock(next.start), language), hours };
}

export function legacySchedule(openingHours: google.maps.places.PlaceOpeningHours | undefined, utcOffsetMinutes: number): Schedule {
  return normalizedSchedule((openingHours?.periods ?? []).map((period) => ({
    open: { day: period.open.day, hour: period.open.hours, minute: period.open.minutes },
    close: period.close ? { day: period.close.day, hour: period.close.hours, minute: period.close.minutes } : undefined,
  })), utcOffsetMinutes);
}
export function getLegacySchedule(openingHours: google.maps.places.PlaceOpeningHours | undefined, utcOffsetMinutes: number, language: Language) {
  return calculateSchedule(legacySchedule(openingHours, utcOffsetMinutes), language);
}

export const categoryTranslations: Record<Language, Record<string, string>> = {
  pt: { restaurant: 'Restaurante', spanish_restaurant: 'Restaurante espanhol', museum: 'Museu', art_museum: 'Museu de arte', park: 'Parque', tourist_attraction: 'Atração', historical_landmark: 'Marco histórico', lodging: 'Hotel', hotel: 'Hotel', cafe: 'Café', bar: 'Bar', store: 'Loja', shopping_mall: 'Shopping', church: 'Igreja', castle: 'Castelo', garden: 'Jardim', performing_arts_theater: 'Teatro', stadium: 'Estádio', history_culture: 'História & cultura' },
  es: { restaurant: 'Restaurante', spanish_restaurant: 'Restaurante español', museum: 'Museo', art_museum: 'Museo de arte', park: 'Parque', tourist_attraction: 'Atracción', historical_landmark: 'Monumento histórico', lodging: 'Alojamiento', hotel: 'Hotel', cafe: 'Cafetería', bar: 'Bar', store: 'Tienda', shopping_mall: 'Centro comercial', church: 'Iglesia', castle: 'Castillo', garden: 'Jardín', performing_arts_theater: 'Teatro', stadium: 'Estadio', history_culture: 'Historia y cultura' },
  en: { restaurant: 'Restaurant', spanish_restaurant: 'Spanish restaurant', museum: 'Museum', art_museum: 'Art museum', park: 'Park', tourist_attraction: 'Attraction', historical_landmark: 'Historical landmark', lodging: 'Lodging', hotel: 'Hotel', cafe: 'Cafe', bar: 'Bar', store: 'Store', shopping_mall: 'Shopping mall', church: 'Church', castle: 'Castle', garden: 'Garden', performing_arts_theater: 'Theater', stadium: 'Stadium', history_culture: 'History & culture' },
};

export function genericPlace(language: Language) { return language === 'es' ? 'Lugar' : language === 'en' ? 'Place' : 'Lugar'; }

export function unnamedPlace(language: Language) { return language === 'es' ? 'Lugar sin nombre' : language === 'en' ? 'Unnamed place' : 'Lugar sem nome'; }

export function missingAddress(language: Language) { return language === 'es' ? 'Dirección no disponible' : language === 'en' ? 'Address unavailable' : 'Endereço não informado'; }

export function closedToday(language: Language) { return language === 'es' ? 'Cerrado hoy' : language === 'en' ? 'Closed today' : 'Fechado hoje'; }

export function openNow(language: Language) { return language === 'es' ? 'Abierto ahora' : language === 'en' ? 'Open now' : 'Aberto agora'; }

export function closesIn(minutes: number, language: Language) { return language === 'es' ? `Cierra en ${minutes} min` : language === 'en' ? `Closes in ${minutes} min` : `Fecha em ${minutes} min`; }

export function opensIn(minutes: number, language: Language) { return language === 'es' ? `Abre en ${minutes} min` : language === 'en' ? `Opens in ${minutes} min` : `Abre em ${minutes} min`; }

export function opensAt(time: string, language: Language) { return language === 'es' ? `Abre a las ${time}` : language === 'en' ? `Opens at ${time}` : `Abre às ${time}`; }

export function unavailableSchedule(language: Language): { status: PlaceStatus; label: string; hours: string } {
  return language === 'es' ? { status: 'closed', label: 'Horario no disponible', hours: 'Consulta Google Maps' } : language === 'en' ? { status: 'closed', label: 'Hours unavailable', hours: 'Check Google Maps' } : { status: 'closed', label: 'Horário não informado', hours: 'Consulte o Google Maps' };
}

export const categoryAliases: Record<string, string> = {
  'história & cultura': 'history_culture', 'historia y cultura': 'history_culture', 'history & culture': 'history_culture',
  restaurante: 'restaurant', restaurant: 'restaurant', museo: 'museum', museu: 'museum', museum: 'museum',
  'museu de arte': 'art_museum', 'museo de arte': 'art_museum', 'art museum': 'art_museum',
  parque: 'park', park: 'park', atração: 'tourist_attraction', atracción: 'tourist_attraction', attraction: 'tourist_attraction',
  'marco histórico': 'historical_landmark', 'monumento histórico': 'historical_landmark', 'historical landmark': 'historical_landmark',
  hotel: 'hotel', café: 'cafe', cafeteria: 'cafe', cafe: 'cafe', bar: 'bar', loja: 'store', tienda: 'store', store: 'store',
  shopping: 'shopping_mall', 'centro comercial': 'shopping_mall', 'shopping mall': 'shopping_mall', igreja: 'church', iglesia: 'church', church: 'church',
  castelo: 'castle', castillo: 'castle', castle: 'castle', jardim: 'garden', jardín: 'garden', garden: 'garden', teatro: 'performing_arts_theater', theater: 'performing_arts_theater', estádio: 'stadium', estadio: 'stadium', stadium: 'stadium',
};

export function localizedCategory(category: string, language: Language) {
  const alias = category.trim().toLocaleLowerCase(languageLocales[language]);
  const key = Object.hasOwn(categoryAliases, alias) ? categoryAliases[alias] : undefined;
  return key ? categoryTranslations[language][key] : category;
}

export function localizedStatusLabel(label: string, language: Language) {
  const minutes = label.match(/(\d+)\s*min/i)?.[1];
  const time = label.match(/(\d{1,2}:\d{2})/)?.[1];
  if (/aberto agora|abierto ahora|open now/i.test(label)) return openNow(language);
  if (/fecha em|cierra en|closes in/i.test(label) && minutes) return closesIn(Number(minutes), language);
  if (/abre em|abre en|opens in/i.test(label) && minutes) return opensIn(Number(minutes), language);
  if (/abre às|abre a las|opens at/i.test(label) && time) return opensAt(time, language);
  if (/horário não informado|horario no disponible|hours unavailable/i.test(label)) return unavailableSchedule(language).label;
  if (/atualizando|actualizando|updating/i.test(label)) return language === 'es' ? 'Actualizando' : language === 'en' ? 'Updating' : 'Atualizando';
  if (/^fechado$|^cerrado$|^closed$/i.test(label)) return translations[language].closedStatus;
  return label;
}

export function localizedHours(hours: string, language: Language) {
  if (/fechado hoje|cerrado hoy|closed today/i.test(hours)) return closedToday(language);
  if (/consulte o google maps|consulta google maps|check google maps/i.test(hours)) return unavailableSchedule(language).hours;
  return hours;
}

export function formatPlaceType(type: string | undefined, language: Language) {
  if (!type) return genericPlace(language);
  const known = categoryTranslations[language];
  return Object.hasOwn(known, type) ? known[type] : type.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function parseLegacyAttribution(html?: string): { name: string; url: string } | undefined {
  if (!html) return undefined;
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const link = documentNode.querySelector('a');
  return link?.href ? { name: link.textContent?.trim() || 'Google Maps', url: link.href } : undefined;
}

export function toSavedPlace(livePlace: google.maps.places.Place, destination: string, note: string, id: string, userPosition: google.maps.LatLngLiteral | null, language: Language): Place {
  const location = livePlace.location?.toJSON();
  const hours = livePlace.currentOpeningHours ?? livePlace.regularOpeningHours;
  const schedule = getLiveSchedule(hours, livePlace.utcOffsetMinutes ?? 0, language);
  const photo = livePlace.photos?.[0];
  const attribution = photo?.authorAttributions?.[0];
  return {
    id, placeId: livePlace.id, destination, note,
    name: livePlace.displayName || unnamedPlace(language),
    category: livePlace.primaryType ? formatPlaceType(livePlace.primaryType, language) : livePlace.primaryTypeDisplayName || genericPlace(language),
    address: livePlace.formattedAddress || missingAddress(language),
    hours: schedule.hours, status: schedule.status, statusLabel: schedule.label,
    distance: location && userPosition ? formatDistance(haversineMeters(userPosition, location), language) : '—',
    photo: photo?.getURI({ maxWidth: 1200, maxHeight: 800 }) || '',
    photoAttribution: attribution ? { name: attribution.displayName, url: attribution.uri ?? '' } : undefined,
    photoAttributions: (photo?.authorAttributions ?? []).map((author) => ({ name: author.displayName, url: author.uri ?? '' })), photoSource: 'google',
    openingSchedule: liveSchedule(hours, livePlace.utcOffsetMinutes ?? 0),
    x: 50, y: 50, rating: livePlace.rating?.toLocaleString(languageLocales[language], { minimumFractionDigits: 1, maximumFractionDigits: 1 }) || '—',
    lat: location?.lat, lng: location?.lng, googleMapsURI: livePlace.googleMapsURI ?? undefined,
  };
}

export function liveSchedule(openingHours: google.maps.places.OpeningHours | null | undefined, utcOffsetMinutes: number): Schedule {
  return normalizedSchedule(openingHours?.periods ?? [], utcOffsetMinutes);
}
export function getLiveSchedule(openingHours: google.maps.places.OpeningHours | null | undefined, utcOffsetMinutes: number, language: Language) {
  return calculateSchedule(liveSchedule(openingHours, utcOffsetMinutes), language);
}

export function formatClock(hour: number, minute: number) { return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`; }

export function haversineMeters(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) {
  const toRad = (value: number) => value * Math.PI / 180;
  const radius = 6371e3;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function formatDistance(meters: number, language: Language) { return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${(meters / 1000).toLocaleString(languageLocales[language], { maximumFractionDigits: 1 })} km`; }

export function sortableDistance(place: Place, userPosition: google.maps.LatLngLiteral | null) {
  if (userPosition && place.lat != null && place.lng != null) return haversineMeters(userPosition, { lat: place.lat, lng: place.lng });
  return Number.POSITIVE_INFINITY;
}

export function formatGoogleError(error: unknown, language: Language) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/RESOURCE_EXHAUSTED|quota exceeded|GetPlaceRequest/i.test(message)) {
    return language === 'es' ? 'Se alcanzó el límite diario de Google Places. Tu itinerario guardado sigue disponible.' : language === 'en' ? 'The daily Google Places limit was reached. Your saved itinerary is still available.' : 'Limite diário do Google Places atingido. Seu roteiro salvo continua disponível.';
  }
  if (/REQUEST_DENIED|ApiNotActivated|not authorized|referer/i.test(message)) {
    return language === 'es' ? 'Google Places rechazó la solicitud. Revisa las APIs y las restricciones de la clave.' : language === 'en' ? 'Google Places rejected the request. Check the APIs and key restrictions.' : 'O Google Places recusou a solicitação. Confira as APIs e as restrições da chave.';
  }
  if (/NOT_FOUND|Place ID is no longer valid/i.test(message)) {
    return language === 'es' ? 'Un lugar guardado ya no existe en Google Maps. Conservamos los datos anteriores en el itinerario.' : language === 'en' ? 'A saved place no longer exists in Google Maps. We kept its previous itinerary data.' : 'Um local salvo não existe mais no Google Maps. Mantivemos os dados anteriores no roteiro.';
  }
  return message || (language === 'es' ? 'Google Places no respondió. Inténtalo de nuevo en unos instantes.' : language === 'en' ? 'Google Places did not respond. Try again in a moment.' : 'O Google Places não respondeu. Tente novamente em instantes.');
}
