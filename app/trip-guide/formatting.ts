import { languageLocales, type Copy, type Language } from '../i18n';
import type { Place, TravelMode } from './types';

export function getDirectionsUrl(place: Place, mode: TravelMode) {
  const params = new URLSearchParams({
    api: '1',
    destination: place.name,
    destination_place_id: place.placeId,
    travelmode: mode,
    dir_action: 'navigate',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function userInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return `${words[0]?.[0] ?? 'G'}${words.length > 1 ? words.at(-1)?.[0] ?? '' : ''}`.toLocaleUpperCase('pt-BR');
}

export function placesCountLabel(count: number, t: Copy) { return `${count} ${count === 1 ? t.place : t.places}`; }

export function savedPlacesLabel(count: number, t: Copy) {
  if (count === 0) return t.noSavedPlace;
  return `${count} ${count === 1 ? t.savedPlace : t.savedPlaces}`;
}

export function exploreSummary(openCount: number, soonCount: number, t: Copy) {
  if (openCount === 0 && soonCount === 0) return t.exploreNone;
  const openLabel = `${openCount} ${openCount === 1 ? t.openPlace : t.openPlaces}`;
  if (soonCount > 0) return `${openLabel} ${soonCount} ${t.scheduleChange}`;
  return `${openLabel} ${t.visitNow}`;
}

export function formatDateLabel(date: Date, language: Language) {
  const locale = languageLocales[language];
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: '2-digit', month: 'short' })
    .format(date).replace('.', '').toLocaleUpperCase(locale);
}
