'use client';

/* State in these effects is synchronized from browser storage, Google Maps and geolocation callbacks. */
/* eslint-disable react-hooks/set-state-in-effect */
/* Google Places returns signed, dynamic photo URLs that cannot use a fixed Next Image host allowlist. */
/* eslint-disable @next/next/no-img-element */

import {
  Bike, BusFront, Car, Check, ChevronDown, Clock3, Compass, Footprints, LocateFixed,
  Map as MapIcon, MapPin, Menu, Navigation, Plus, Search, SlidersHorizontal,
  Cloud, LogOut, Moon, Sun, ShieldCheck, Sparkles, Star, Trash2, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { languageLocales, languageOptions, normalizeLanguage, translations, type Copy, type Language } from './i18n';
import { createMarkerRegistry } from './map-markers';

type Theme = 'light' | 'dark';

type PlaceStatus = 'open' | 'soon' | 'closed';
type Place = {
  id: string; placeId: string; name: string; category: string; address: string;
  hours: string; status: PlaceStatus; statusLabel: string; distance: string;
  note: string; photo: string; x: number; y: number; rating: string; destination?: string;
  lat?: number; lng?: number; googleMapsURI?: string; photoAttribution?: { name: string; url: string };
  pinColor?: string;
};
type StoredPlaceRef = Partial<Place> & Pick<Place, 'id' | 'placeId'> & { destination: string };

type MapsStatus = 'loading' | 'ready' | 'needs-key' | 'error';
type AuthUser = { id: string; email: string; name: string; picture?: string };
type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
type GoogleIdentityApi = {
  initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
};
type SearchPrediction = {
  placeId: string;
  mainText: string;
  secondaryText: string;
  distanceMeters?: number | null;
  modern?: google.maps.places.PlacePrediction;
};

const initialPlaces: Place[] = [
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

const statusPinColors: Record<PlaceStatus, string> = { open: '#1f7a50', soon: '#e1a43a', closed: '#9a7068' };
const pinColorChoices = [
  { color: '#1f7a50', label: 'green' as const }, { color: '#e1a43a', label: 'yellow' as const },
  { color: '#d65c52', label: 'red' as const }, { color: '#2f80da', label: 'blue' as const },
  { color: '#7b61a8', label: 'purple' as const },
];
const removedPlacesStorageKey = 'roamly-removed-place-keys';
const legacyPlaceIds: Record<string, string> = {
  ChIJpy0369sQQg0R2lMStY3WFgw: 'ChIJwamkfX4oQg0RUUjO1nnsfy4',
  ChIJv_4a4ZYoQg0R2DJ8JCQx3jk: 'ChIJe4IR9Z8oQg0RrqMktRYnbJ4',
  ChIJW7dQGYYoQg0Rql2PUtWg3xw: 'ChIJ5W0gy3goQg0RztECvkbsm30',
};

function placeKey(placeId: string, destination = 'Madri') {
  return `${legacyPlaceIds[placeId] ?? placeId}:${destination.trim().toLocaleLowerCase('pt-BR')}`;
}

function dedupePlaces(items: Place[]) {
  const seen = new Set<string>();
  return items.filter((place) => {
    const key = placeKey(place.placeId, place.destination ?? 'Madri');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function Home() {
  const [theme, setTheme] = useState<Theme>('light');
  const [themeReady, setThemeReady] = useState(false);
  const [language, setLanguage] = useState<Language>('pt');
  const t = translations[language];
  const locale = languageLocales[language];
  const [places, setPlaces] = useState(initialPlaces);
  const [selectedId, setSelectedId] = useState('prado');
  const [detailsDismissed, setDetailsDismissed] = useState(false);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [mapPendingDelete, setMapPendingDelete] = useState<string | null>(null);
  const [mapsOpen, setMapsOpen] = useState(false);
  const [newMapName, setNewMapName] = useState('');
  const [maps, setMaps] = useState(['Madri']);
  const [currentMap, setCurrentMap] = useState('Madri');
  const [locationLabel, setLocationLabel] = useState('Sua localização');
  const [toast, setToast] = useState('');
  const [zoom, setZoom] = useState(1);
  const [storageReady, setStorageReady] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [mapsStatus, setMapsStatus] = useState<MapsStatus>('loading');
  const [mapsError, setMapsError] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<SearchPrediction[]>([]);
  const [isSearchingGoogle, setIsSearchingGoogle] = useState(false);
  const [liveMap, setLiveMap] = useState<google.maps.Map | null>(null);
  const [userPosition, setUserPosition] = useState<google.maps.LatLngLiteral | null>(null);
  const [trackLocation, setTrackLocation] = useState(false);
  const [mapPlaceCandidate, setMapPlaceCandidate] = useState<Place | null>(null);
  const [mapPlaceLoading, setMapPlaceLoading] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [oauthClientId, setOauthClientId] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const addingPlaceKeysRef = useRef(new Set<string>());
  const hydratedPlaceKeysRef = useRef(new Set<string>());
  const locationRequestedRef = useRef(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const cloudLoadedForUserRef = useRef('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    setThemeReady(true);
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#14201b' : '#fffdfa');
    try { localStorage.setItem('roamly-theme', next); } catch { /* Theme still works when storage is unavailable. */ }
    setTheme(next);
  }

  const updateUserPosition = useCallback((next: google.maps.LatLngLiteral) => {
    // Ignore sub-metre GPS noise; distances and the blue dot remain live as you move.
    setUserPosition((previous) => previous && haversineMeters(previous, next) < 1 ? previous : next);
  }, []);

  useEffect(() => {
    const savedLanguage = normalizeLanguage(localStorage.getItem('roamly-language'));
    setLanguage(savedLanguage);
    setLocationLabel(translations[savedLanguage].yourLocation);
    document.documentElement.lang = languageLocales[savedLanguage];
  }, []);

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    localStorage.setItem('roamly-language', nextLanguage);
    document.documentElement.lang = languageLocales[nextLanguage];
    setLocationLabel(userPosition ? translations[nextLanguage].liveLocation : translations[nextLanguage].yourLocation);
    hydratedPlaceKeysRef.current.clear();
  }

  const handleGoogleCredential = useCallback(async (response: { credential?: string }) => {
    if (!response.credential) { setAuthError(language === 'es' ? 'Google no devolvió una credencial válida.' : language === 'en' ? 'Google did not return a valid credential.' : 'O Google não retornou uma credencial válida.'); return; }
    setAuthLoading(true);
    setAuthError('');
    try {
      const result = await fetch('/api/auth/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: response.credential }),
      });
      const payload = await result.json() as { user?: AuthUser; error?: string };
      if (!result.ok || !payload.user) throw new Error(payload.error || (language === 'es' ? 'No se pudo iniciar sesión' : language === 'en' ? 'Could not sign in' : 'Não foi possível entrar'));
      cloudLoadedForUserRef.current = '';
      setAuthUser(payload.user);
      setAuthOpen(false);
      setToast(language === 'es' ? `¡Hola, ${payload.user.name.split(' ')[0]}! Sincronizando tus itinerarios…` : language === 'en' ? `Hi, ${payload.user.name.split(' ')[0]}! Syncing your itineraries…` : `Olá, ${payload.user.name.split(' ')[0]}! Sincronizando seus roteiros…`);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : language === 'es' ? 'No se pudo iniciar sesión con Google.' : language === 'en' ? 'Could not sign in with Google.' : 'Não foi possível entrar com o Google.');
    } finally { setAuthLoading(false); }
  }, [language]);

  useEffect(() => {
    const savedNotes = localStorage.getItem('roamly-notes');
    try {
      const notes = savedNotes ? JSON.parse(savedNotes) as Record<string, string> : {};
      const savedMapsRaw = localStorage.getItem('roamly-maps');
      const savedMaps = savedMapsRaw === null ? null : JSON.parse(savedMapsRaw) as string[];
      const savedRefs = JSON.parse(localStorage.getItem('roamly-place-refs') ?? '[]') as StoredPlaceRef[];
      const removedKeys = new Set((JSON.parse(localStorage.getItem(removedPlacesStorageKey) ?? '[]') as string[]).map((key) => {
        const separator = key.indexOf(':');
        if (separator < 0) return key;
        const oldPlaceId = key.slice(0, separator);
        return `${legacyPlaceIds[oldPlaceId] ?? oldPlaceId}${key.slice(separator)}`;
      }));
      if (Array.isArray(savedMaps)) {
        const restoredMaps = Array.from(new Set(savedMaps));
        const savedCurrentMap = localStorage.getItem('roamly-current-map');
        setMaps(restoredMaps);
        setCurrentMap(savedCurrentMap && restoredMaps.includes(savedCurrentMap) ? savedCurrentMap : restoredMaps[0] ?? '');
      }
      setPlaces((current) => {
        const savedRefByKey = new Map(savedRefs.map((ref) => [placeKey(ref.placeId, ref.destination), ref]));
        const hydrated = current.map((place) => {
          const savedRef = savedRefByKey.get(placeKey(place.placeId, place.destination ?? 'Madri'));
          return {
            ...place,
            ...savedRef,
            id: place.id,
            placeId: place.placeId,
            destination: place.destination,
            note: notes[place.id] ?? savedRef?.note ?? place.note,
            photo: savedRef?.photo || place.photo,
            pinColor: savedRef?.pinColor ?? place.pinColor,
          };
        });
        const known = new Set(hydrated.map((place) => placeKey(place.placeId, place.destination ?? 'Madri')));
        const restored = savedRefs.filter((ref) => !known.has(placeKey(ref.placeId, ref.destination))).map((ref, index) => ({
          ...ref,
          id: ref.id, placeId: ref.placeId, destination: ref.destination, note: ref.note ?? '', pinColor: ref.pinColor,
          name: ref.name ?? 'Carregando lugar…', category: ref.category ?? 'Google Places', address: ref.address ?? '', hours: ref.hours ?? 'Consultando horários',
          status: ref.status ?? 'closed' as PlaceStatus, statusLabel: ref.statusLabel ?? 'Atualizando', distance: ref.distance ?? '—', photo: ref.photo ?? '',
          x: ref.x ?? 45 + index * 4, y: ref.y ?? 45 + index * 3, rating: ref.rating ?? '—',
        }));
        return dedupePlaces([...hydrated, ...restored]).filter((place) => !removedKeys.has(placeKey(place.placeId, place.destination ?? 'Madri')));
      });
    } catch { /* Keep curated defaults if local data is invalid. */ }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    localStorage.setItem('roamly-maps', JSON.stringify(maps));
    localStorage.setItem('roamly-current-map', currentMap);
    localStorage.setItem('roamly-place-refs', JSON.stringify(dedupePlaces(places).map((place) => ({ ...place, destination: place.destination ?? 'Madri' }))));
  }, [maps, places, currentMap, storageReady]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/google-config').then(async (response) => await response.json() as { apiKey?: string }).catch(() => ({ apiKey: '' })).then((config) => {
      if (cancelled) return;
      setApiKey(config.apiKey || localStorage.getItem('roamly-google-maps-key') || '');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/auth/config').then(async (response) => await response.json() as { clientId?: string }).catch(() => ({ clientId: '' })),
      fetch('/api/auth/session').then(async (response) => await response.json() as { user?: AuthUser | null }).catch(() => ({ user: null })),
    ]).then(([config, session]) => {
      if (cancelled) return;
      setOauthClientId(config.clientId ?? '');
      setAuthUser(session.user ?? null);
      setAuthLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!authOpen || authUser || !oauthClientId || !googleButtonRef.current) return;
    let cancelled = false;
    loadGoogleIdentity().then((identity) => {
      if (cancelled || !googleButtonRef.current) return;
      identity.initialize({ client_id: oauthClientId, callback: handleGoogleCredential });
      googleButtonRef.current.replaceChildren();
      identity.renderButton(googleButtonRef.current, { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale, width: 300 });
    }).catch(() => { if (!cancelled) setAuthError(language === 'es' ? 'No se pudo cargar el inicio de sesión de Google.' : language === 'en' ? 'Could not load Google sign-in.' : 'Não foi possível carregar o login do Google.'); });
    return () => { cancelled = true; };
  }, [authOpen, authUser, handleGoogleCredential, language, locale, oauthClientId]);

  useEffect(() => {
    if (!authUser || !storageReady || cloudLoadedForUserRef.current === authUser.id) return;
    let cancelled = false;
    setSyncStatus('syncing');
    fetch('/api/sync', { headers: { Accept: 'application/json' } }).then(async (response) => {
      if (!response.ok) throw new Error(language === 'es' ? 'No se pudieron cargar tus itinerarios' : language === 'en' ? 'Could not load your itineraries' : 'Não foi possível carregar seus roteiros');
      return await response.json() as { data?: { maps?: string[]; currentMap?: string; places?: Place[] } | null };
    }).then(async ({ data }) => {
      if (cancelled) return;
      if (data && Array.isArray(data.maps) && Array.isArray(data.places)) {
        const nextMaps = Array.from(new Set(data.maps));
        const nextMap = data.currentMap && nextMaps.includes(data.currentMap) ? data.currentMap : nextMaps[0] ?? '';
        const nextPlaces = dedupePlaces(data.places);
        setMaps(nextMaps);
        setCurrentMap(nextMap);
        setPlaces(nextPlaces);
        setSelectedId(nextPlaces.find((place) => (place.destination ?? 'Madri') === nextMap)?.id ?? '');
        localStorage.setItem('roamly-notes', JSON.stringify(Object.fromEntries(nextPlaces.map((place) => [place.id, place.note]))));
        hydratedPlaceKeysRef.current.clear();
        setToast(language === 'es' ? 'Itinerarios cargados desde tu Cuenta de Google' : language === 'en' ? 'Itineraries loaded from your Google Account' : 'Roteiros carregados da sua conta Google');
      } else {
        await saveCloudState(maps, currentMap, places);
        if (!cancelled) setToast(language === 'es' ? 'Los itinerarios de este dispositivo se vincularon a tu cuenta' : language === 'en' ? 'This device’s itineraries were linked to your account' : 'Roteiros deste aparelho vinculados à sua conta');
      }
      if (!cancelled) {
        cloudLoadedForUserRef.current = authUser.id;
        setSyncStatus('synced');
      }
    }).catch(() => { if (!cancelled) setSyncStatus('error'); });
    return () => { cancelled = true; };
    // Run once for each authenticated account after local storage is restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, storageReady, language]);

  useEffect(() => {
    if (!authUser || !storageReady || cloudLoadedForUserRef.current !== authUser.id) return;
    setSyncStatus('syncing');
    const timer = window.setTimeout(() => {
      saveCloudState(maps, currentMap, places).then(() => setSyncStatus('synced')).catch(() => setSyncStatus('error'));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [authUser, currentMap, maps, places, storageReady]);

  useEffect(() => {
    if (apiKey === null) return;
    if (!apiKey) { setMapsStatus('needs-key'); return; }
    if (window.google?.maps?.Map && window.google.maps.marker?.AdvancedMarkerElement) {
      setMapsStatus('ready');
      return;
    }
    let cancelled = false;
    setMapsStatus('loading'); setMapsError('');
    loadGoogleMaps(apiKey, language).then(() => {
      if (!google.maps.Map) throw new Error('A Maps JavaScript API precisa estar habilitada nesta chave.');
      if (!cancelled) setMapsStatus('ready');
    }).catch((error: Error) => {
      if (!cancelled) { setMapsStatus('error'); setMapsError(error.message || 'Não foi possível carregar o Google Maps.'); }
    });
    return () => { cancelled = true; };
  }, [apiKey, language]);

  useEffect(() => {
    if (mapsStatus !== 'ready' || userPosition || locationRequestedRef.current || !navigator.geolocation) return;
    locationRequestedRef.current = true;
    setIsLocating(true);
    setLocationLabel(t.calculatingDistances);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserPosition({ lat: position.coords.latitude, lng: position.coords.longitude });
        setTrackLocation(true);
        setLocationLabel(t.liveLocation);
        setIsLocating(false);
      },
      () => {
        setLocationLabel(language === 'es' ? 'Activa la ubicación para ver distancias' : language === 'en' ? 'Enable location to see distances' : 'Ative a localização para ver distâncias');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }, [mapsStatus, userPosition, language, t.calculatingDistances, t.liveLocation]);

  useEffect(() => {
    if (mapsStatus !== 'ready' || !storageReady || !currentMap) return;
    let cancelled = false;
    const candidates = places.filter((place) => {
      const key = placeKey(place.placeId, place.destination ?? 'Madri');
      if ((place.destination ?? 'Madri') !== currentMap || hydratedPlaceKeysRef.current.has(key)) return false;
      hydratedPlaceKeysRef.current.add(key);
      return true;
    });
    Promise.allSettled(candidates.map(async (savedPlace) => {
      const hydrated = await hydratePlaceById(savedPlace, userPosition, language);
      if (!cancelled) setPlaces((current) => dedupePlaces(current.map((item) => item.id === savedPlace.id ? {
        ...hydrated,
        note: item.note,
        pinColor: item.pinColor,
        photo: hydrated.photo || item.photo,
        photoAttribution: hydrated.photoAttribution || item.photoAttribution,
      } : item)));
    })).then((results) => {
      if (cancelled) return;
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failure) setToast(formatGoogleError(failure.reason, language));
    });
    return () => { cancelled = true; };
    // Refresh only the active itinerary once per browser session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsStatus, storageReady, currentMap, language]);

  const visiblePlaces = useMemo(() => {
    const normalized = mapsStatus === 'ready' ? '' : query.trim().toLocaleLowerCase(locale);
    return places.filter((place) => {
      const matches = !normalized || `${place.name} ${place.category} ${place.address}`.toLocaleLowerCase(locale).includes(normalized);
      return (place.destination ?? 'Madri') === currentMap && matches && (!onlyOpen || place.status === 'open');
    }).map((place) => userPosition && place.lat != null && place.lng != null
      ? { ...place, distance: formatDistance(haversineMeters(userPosition, { lat: place.lat, lng: place.lng }), language) }
      : place).sort((a, b) => {
      const aDistance = sortableDistance(a, userPosition);
      const bDistance = sortableDistance(b, userPosition);
      if (!Number.isFinite(aDistance) && Number.isFinite(bDistance)) return 1;
      if (Number.isFinite(aDistance) && !Number.isFinite(bDistance)) return -1;
      return aDistance !== bDistance ? aDistance - bDistance : a.name.localeCompare(b.name, locale);
    });
  }, [places, query, onlyOpen, currentMap, mapsStatus, userPosition, locale, language]);

  const todayLabel = useMemo(() => formatDateLabel(new Date(), language), [language]);
  const openPlacesCount = visiblePlaces.filter((place) => place.status === 'open').length;
  const soonPlacesCount = visiblePlaces.filter((place) => place.status === 'soon').length;

  useEffect(() => {
    if (detailsDismissed) return;
    if (visiblePlaces.some((place) => place.id === selectedId)) return;
    setSelectedId(visiblePlaces[0]?.id ?? '');
  }, [detailsDismissed, selectedId, visiblePlaces]);

  useEffect(() => {
    if (mapsStatus !== 'ready' || query.trim().length < 2) { setPredictions([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsSearchingGoogle(true);
      try {
        const placesRuntime = google.maps.places as unknown as { AutocompleteSuggestion?: typeof google.maps.places.AutocompleteSuggestion };
        if (!sessionTokenRef.current) sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        if (placesRuntime.AutocompleteSuggestion) {
          const { suggestions } = await placesRuntime.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query, language: locale, sessionToken: sessionTokenRef.current,
            locationBias: liveMap?.getBounds() ?? undefined,
            origin: userPosition ?? liveMap?.getCenter() ?? undefined,
          });
          if (!cancelled) setPredictions(suggestions.map((suggestion) => suggestion.placePrediction).filter((prediction): prediction is google.maps.places.PlacePrediction => Boolean(prediction)).slice(0, 6).map((prediction) => ({
            placeId: prediction.placeId, mainText: prediction.mainText?.toString() || prediction.text.toString(),
            secondaryText: prediction.secondaryText?.toString() || 'Google Maps', distanceMeters: prediction.distanceMeters, modern: prediction,
          })));
        } else if ((google.maps.places as unknown as { AutocompleteService?: typeof google.maps.places.AutocompleteService }).AutocompleteService) {
          const service = new google.maps.places.AutocompleteService();
          const response = await service.getPlacePredictions({ input: query, language: locale, sessionToken: sessionTokenRef.current, locationBias: liveMap?.getBounds() ?? undefined, origin: userPosition ?? liveMap?.getCenter() ?? undefined });
          if (!cancelled) setPredictions(response.predictions.slice(0, 6).map((prediction) => ({
            placeId: prediction.place_id, mainText: prediction.structured_formatting.main_text,
            secondaryText: prediction.structured_formatting.secondary_text, distanceMeters: prediction.distance_meters,
          })));
        } else {
          if (!cancelled) { setPredictions([]); setMapsError(language === 'es' ? 'Habilita Places API en Google Cloud para buscar y añadir lugares.' : language === 'en' ? 'Enable Places API in Google Cloud to search and add places.' : 'Habilite a Places API no Google Cloud para buscar e adicionar novos locais.'); }
        }
      } catch (error) {
        if (!cancelled) { setPredictions([]); setMapsError(formatGoogleError(error, language)); }
      } finally { if (!cancelled) setIsSearchingGoogle(false); }
    }, 280);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, mapsStatus, liveMap, userPosition, language, locale]);

  useEffect(() => {
    if (!userPosition) return;
    setLocationLabel(t.liveLocation);
  }, [userPosition, t.liveLocation]);

  const selected = visiblePlaces.find((place) => place.id === selectedId) ?? places.find((place) => place.id === selectedId) ?? places[0];

  function showPlace(placeId: string) {
    setSelectedId(placeId);
    setDetailsDismissed(false);
    const place = places.find((item) => item.id === placeId);
    if (place?.lat != null && place.lng != null) liveMap?.panTo({ lat: place.lat, lng: place.lng });
  }

  function closePlaceDetails() {
    setDetailsDismissed(true);
    setSelectedId('');
    setRouteOpen(false);
  }

  function saveNote(value: string) {
    const next = places.map((place) => (place.id === selected.id ? { ...place, note: value } : place));
    setPlaces(next);
    localStorage.setItem('roamly-notes', JSON.stringify(Object.fromEntries(next.map((place) => [place.id, place.note]))));
  }

  function savePinColor(pinColor?: string) {
    if (!selected) return;
    setPlaces((current) => current.map((place) => place.id === selected.id ? { ...place, pinColor } : place));
    setToast(pinColor ? (language === 'es' ? 'Color del pin actualizado' : language === 'en' ? 'Pin color updated' : 'Cor do pin atualizada') : (language === 'es' ? 'Color automático restaurado' : language === 'en' ? 'Automatic color restored' : 'Cor automática restaurada'));
  }

  function useMyLocation() {
    if (isLocating) return;
    if (userPosition && liveMap) {
      liveMap.panTo(userPosition);
      liveMap.setZoom(16);
      setLocationLabel(t.liveLocation);
      setToast(language === 'es' ? 'Mapa centrado en tu ubicación' : language === 'en' ? 'Map centered on your location' : 'Mapa centralizado na sua localização');
      return;
    }
    if (!navigator.geolocation) { setToast(language === 'es' ? 'Ubicación no disponible en este dispositivo' : language === 'en' ? 'Location is not available on this device' : 'Localização não disponível neste dispositivo'); return; }
    setTrackLocation(true);
    setIsLocating(true);
    setLocationLabel(language === 'es' ? 'Localizando…' : language === 'en' ? 'Locating…' : 'Localizando…');
    navigator.geolocation.getCurrentPosition(
      (position) => { const next = { lat: position.coords.latitude, lng: position.coords.longitude }; setUserPosition(next); liveMap?.panTo(next); liveMap?.setZoom(16); setLocationLabel(t.liveLocation); setIsLocating(false); setToast(language === 'es' ? 'Mapa centrado en tu ubicación' : language === 'en' ? 'Map centered on your location' : 'Mapa centralizado na sua localização'); },
      () => { setTrackLocation(false); setLocationLabel(language === 'es' ? 'Ubicación no disponible' : language === 'en' ? 'Location unavailable' : 'Localização indisponível'); setIsLocating(false); setToast(language === 'es' ? 'Permite el acceso a la ubicación para centrar el mapa' : language === 'en' ? 'Allow location access to center the map' : 'Permita o acesso à localização para centralizar o mapa'); },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  function openRouteOptions() {
    setRouteOpen(true);
  }

  function openDirections(mode: TravelMode) {
    const url = getDirectionsUrl(selected, mode);
    setRouteOpen(false);
    window.location.assign(url);
  }

  function createMap() {
    if (!newMapName.trim()) return;
    const mapName = newMapName.trim();
    const existingMap = maps.find((item) => item.localeCompare(mapName, locale, { sensitivity: 'base' }) === 0);
    if (existingMap) {
      openMap(existingMap);
      setToast(language === 'es' ? `El mapa “${existingMap}” ya existía y se abrió` : language === 'en' ? `Map “${existingMap}” already existed and was opened` : `Mapa “${existingMap}” já existia e foi aberto`);
    } else {
      setMaps((current) => [...current, mapName]);
      setCurrentMap(mapName);
      setSelectedId('');
      setDetailsDismissed(true);
      setView('map');
      setToast(language === 'es' ? `Mapa “${mapName}” creado` : language === 'en' ? `Map “${mapName}” created` : `Mapa “${mapName}” criado`);
      setMapsOpen(false);
    }
    setNewMapName('');
  }

  function openMap(mapName: string) {
    const firstPlace = places.find((place) => (place.destination ?? 'Madri') === mapName);
    setCurrentMap(mapName);
    setSelectedId(firstPlace?.id ?? '');
    setDetailsDismissed(false);
    setView('map');
    setMapsOpen(false);
    if (firstPlace?.lat != null && firstPlace.lng != null) {
      liveMap?.panTo({ lat: firstPlace.lat, lng: firstPlace.lng });
      liveMap?.setZoom(14);
    }
    setToast(language === 'es' ? `Mapa “${mapName}” abierto` : language === 'en' ? `Map “${mapName}” opened` : `Mapa “${mapName}” aberto`);
  }

  async function selectGooglePrediction(prediction: SearchPrediction) {
    if (!currentMap) { setMapsOpen(true); setToast(language === 'es' ? 'Crea un mapa antes de añadir lugares' : language === 'en' ? 'Create a map before adding places' : 'Crie um mapa antes de adicionar lugares'); return; }
    const key = placeKey(prediction.placeId, currentMap);
    const existing = places.find((item) => placeKey(item.placeId, item.destination ?? 'Madri') === key);
    if (existing) {
      showPlace(existing.id); setQuery(''); setPredictions([]);
      setView('map');
      if (existing.lat != null && existing.lng != null) { liveMap?.panTo({ lat: existing.lat, lng: existing.lng }); liveMap?.setZoom(16); }
      setToast(language === 'es' ? `${existing.name} ya está en este itinerario` : language === 'en' ? `${existing.name} is already in this itinerary` : `${existing.name} já está neste roteiro`);
      return;
    }
    if (addingPlaceKeysRef.current.has(key)) return;
    addingPlaceKeysRef.current.add(key);
    setIsSearchingGoogle(true);
    try {
      const savedPlace = await hydratePrediction(prediction, currentMap, userPosition, language);
      hydratedPlaceKeysRef.current.add(key);
      setPlaces((current) => dedupePlaces([...current, savedPlace]));
      try {
        const removed = JSON.parse(localStorage.getItem(removedPlacesStorageKey) ?? '[]') as string[];
        localStorage.setItem(removedPlacesStorageKey, JSON.stringify(removed.filter((removedKey) => removedKey !== key)));
      } catch { /* A fresh save can continue if old local preferences are malformed. */ }
      showPlace(savedPlace.id); setQuery(''); setPredictions([]);
      setView('map');
      sessionTokenRef.current = null;
      if (savedPlace.lat != null && savedPlace.lng != null) { liveMap?.panTo({ lat: savedPlace.lat, lng: savedPlace.lng }); liveMap?.setZoom(16); }
      setToast(language === 'es' ? `${savedPlace.name} guardado desde Google Places` : language === 'en' ? `${savedPlace.name} saved from Google Places` : `${savedPlace.name} salvo pelo Google Places`);
    } catch (error) {
      setToast(formatGoogleError(error, language));
    } finally { addingPlaceKeysRef.current.delete(key); setIsSearchingGoogle(false); }
  }

  async function selectPlaceFromMap(placeId: string) {
    if (!currentMap) { setMapsOpen(true); setToast(language === 'es' ? 'Crea un mapa antes de añadir lugares' : language === 'en' ? 'Create a map before adding places' : 'Crie um mapa antes de adicionar lugares'); return; }
    const key = placeKey(placeId, currentMap);
    const existing = places.find((item) => placeKey(item.placeId, item.destination ?? 'Madri') === key);
    if (existing) {
      showPlace(existing.id);
      setToast(language === 'es' ? `${existing.name} ya está en este itinerario` : language === 'en' ? `${existing.name} is already in this itinerary` : `${existing.name} já está neste roteiro`);
      return;
    }
    if (mapPlaceLoading || addingPlaceKeysRef.current.has(key)) return;
    setMapPlaceLoading(true);
    try {
      const draft: Place = {
        id: `${placeId}-${currentMap}`, placeId, destination: currentMap, note: '', name: 'Carregando lugar…',
        category: 'Google Places', address: '', hours: '', status: 'closed', statusLabel: 'Atualizando',
        distance: '—', photo: '', x: 50, y: 50, rating: '—',
      };
      const hydrated = await hydratePlaceById(draft, userPosition, language);
      setMapPlaceCandidate(hydrated);
    } catch (error) {
      setToast(formatGoogleError(error, language));
    } finally {
      setMapPlaceLoading(false);
    }
  }

  function addMapPlaceCandidate() {
    if (!mapPlaceCandidate) return;
    const key = placeKey(mapPlaceCandidate.placeId, mapPlaceCandidate.destination ?? currentMap);
    if (addingPlaceKeysRef.current.has(key)) return;
    addingPlaceKeysRef.current.add(key);
    const existing = places.find((item) => placeKey(item.placeId, item.destination ?? 'Madri') === key);
    if (existing) {
      showPlace(existing.id);
      setMapPlaceCandidate(null);
      addingPlaceKeysRef.current.delete(key);
      setToast(language === 'es' ? `${existing.name} ya está en este itinerario` : language === 'en' ? `${existing.name} is already in this itinerary` : `${existing.name} já está neste roteiro`);
      return;
    }
    setPlaces((current) => dedupePlaces([...current, mapPlaceCandidate]));
    hydratedPlaceKeysRef.current.add(key);
    try {
      const removed = JSON.parse(localStorage.getItem(removedPlacesStorageKey) ?? '[]') as string[];
      localStorage.setItem(removedPlacesStorageKey, JSON.stringify(removed.filter((removedKey) => removedKey !== key)));
    } catch { /* A fresh save can continue if old local preferences are malformed. */ }
    showPlace(mapPlaceCandidate.id);
    setMapPlaceCandidate(null);
    addingPlaceKeysRef.current.delete(key);
    setToast(language === 'es' ? `${mapPlaceCandidate.name} añadido al itinerario` : language === 'en' ? `${mapPlaceCandidate.name} added to the itinerary` : `${mapPlaceCandidate.name} adicionado ao roteiro`);
  }

  function removeSelectedPlace() {
    if (!selected) return;
    const key = placeKey(selected.placeId, selected.destination ?? 'Madri');
    const remaining = places.filter((place) => placeKey(place.placeId, place.destination ?? 'Madri') !== key);
    setPlaces(remaining);
    try {
      const removed = JSON.parse(localStorage.getItem(removedPlacesStorageKey) ?? '[]') as string[];
      localStorage.setItem(removedPlacesStorageKey, JSON.stringify(Array.from(new Set([...removed, key]))));
      const notes = JSON.parse(localStorage.getItem('roamly-notes') ?? '{}') as Record<string, string>;
      delete notes[selected.id];
      localStorage.setItem('roamly-notes', JSON.stringify(notes));
    } catch { /* The React state still removes the place for this session. */ }
    const nextSelected = remaining.find((place) => (place.destination ?? 'Madri') === currentMap);
    setSelectedId(nextSelected?.id ?? '');
    setDetailsDismissed(false);
    setRemoveConfirmOpen(false);
    setRouteOpen(false);
    setToast(language === 'es' ? `${selected.name} eliminado del itinerario` : language === 'en' ? `${selected.name} removed from the itinerary` : `${selected.name} removido do roteiro`);
  }

  function deleteMap() {
    if (!mapPendingDelete) return;
    const remainingMaps = maps.filter((mapName) => mapName !== mapPendingDelete);
    const deletedPlaces = places.filter((place) => (place.destination ?? 'Madri') === mapPendingDelete);
    const remainingPlaces = places.filter((place) => (place.destination ?? 'Madri') !== mapPendingDelete);
    try {
      const removed = JSON.parse(localStorage.getItem(removedPlacesStorageKey) ?? '[]') as string[];
      const deletedKeys = deletedPlaces.map((place) => placeKey(place.placeId, place.destination ?? 'Madri'));
      localStorage.setItem(removedPlacesStorageKey, JSON.stringify(Array.from(new Set([...removed, ...deletedKeys]))));
      const notes = JSON.parse(localStorage.getItem('roamly-notes') ?? '{}') as Record<string, string>;
      deletedPlaces.forEach((place) => delete notes[place.id]);
      localStorage.setItem('roamly-notes', JSON.stringify(notes));
    } catch { /* The React state still removes the map for this session. */ }
    setMaps(remainingMaps);
    setPlaces(remainingPlaces);
    if (currentMap === mapPendingDelete) {
      const nextMap = remainingMaps[0] ?? '';
      setCurrentMap(nextMap);
      setSelectedId(remainingPlaces.find((place) => (place.destination ?? 'Madri') === nextMap)?.id ?? '');
      setDetailsDismissed(false);
    }
    setRouteOpen(false);
    setRemoveConfirmOpen(false);
    setToast(language === 'es' ? `Mapa “${mapPendingDelete}” eliminado` : language === 'en' ? `Map “${mapPendingDelete}” deleted` : `Mapa “${mapPendingDelete}” excluído`);
    setMapPendingDelete(null);
  }

  function connectGoogleMaps(key: string) {
    const cleanKey = key.trim();
    if (!cleanKey) return;
    localStorage.setItem('roamly-google-maps-key', cleanKey);
    setApiKey(cleanKey);
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    cloudLoadedForUserRef.current = '';
    setAuthUser(null);
    setSyncStatus('idle');
    setAuthOpen(false);
    setToast(language === 'es' ? 'Cerraste sesión. Los itinerarios siguen guardados en el dispositivo.' : language === 'en' ? 'You signed out. Your itineraries remain saved on this device.' : 'Você saiu da conta. Os roteiros continuam salvos no aparelho.');
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label="Roamly"><span><Compass size={20} /></span><strong>Roamly</strong></div>
        <button className="trip-switcher" onClick={() => setMapsOpen(true)} aria-label={t.switchTrip}>
          <span className="trip-pin"><MapPin size={17} fill="currentColor" /></span>
          <span><small>{t.itinerary}</small><strong>{currentMap || t.createMap}</strong></span><ChevronDown size={17} />
        </button>
        <div className="header-actions">
          <span className={`live-pill ${mapsStatus === 'ready' ? 'online' : ''}`}><i />{mapsStatus === 'ready' ? t.mapsLive : t.connecting}</span>
          {authUser && <span className={`sync-pill ${syncStatus}`}><Cloud size={12} />{syncStatus === 'synced' ? t.synced : syncStatus === 'error' ? t.syncError : t.syncing}</span>}
          <label className="language-picker" title={t.language}><span>{language.toUpperCase()}</span><select value={language} onChange={(event) => changeLanguage(event.target.value as Language)} aria-label={t.language}>{languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13} /></label>
          <button className="theme-toggle" onClick={toggleTheme} disabled={!themeReady} aria-label={theme === 'dark' ? t.enableLightMode : t.enableDarkMode} title={theme === 'dark' ? t.enableLightMode : t.enableDarkMode} aria-pressed={theme === 'dark'}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button>
          <button className={`avatar ${authUser ? 'signed-in' : ''}`} onClick={() => setAuthOpen(true)} aria-label={authUser ? `${t.openAccount} ${authUser.name}` : t.signInGoogle} title={authUser?.email || t.signInGoogle}>{authUser ? userInitials(authUser.name) : 'G'}</button>
        </div>
      </header>

      <section className="toolbar" aria-label={t.mapTools}>
        <div className="search-wrap">
          <Search size={19} />
          <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mapsStatus === 'ready' ? t.searchMaps : t.searchItinerary} aria-label={t.searchMaps} autoComplete="off" />
          {isSearchingGoogle && <span className="search-spinner" aria-label={t.searching} />}
          {query && <button onClick={() => setQuery('')} aria-label={t.clearSearch}><X size={16} /></button>}
          {mapsStatus === 'ready' && query.trim().length >= 2 && (
            <div className="google-results" role="listbox" aria-label={t.mapsResults}>
              {predictions.map((prediction) => {
                const saved = places.some((item) => placeKey(item.placeId, item.destination ?? 'Madri') === placeKey(prediction.placeId, currentMap));
                return <button key={prediction.placeId} onClick={() => !saved && selectGooglePrediction(prediction)} role="option" disabled={saved} aria-disabled={saved} aria-selected={saved}>
                  <span className="result-pin"><MapPin size={16} /></span>
                  <span><strong>{prediction.mainText}</strong><small>{prediction.secondaryText}</small></span>
                  {saved ? <em className="saved-result"><Check size={13} /> {t.saved}</em> : prediction.distanceMeters != null && <em>{formatDistance(prediction.distanceMeters, language)}</em>}
                </button>;
              })}
              {!isSearchingGoogle && predictions.length === 0 && <p>{t.noResults}</p>}
              {mapsError && <p className="search-api-warning">{mapsError}</p>}
              <div className="google-attribution"><img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" /></div>
            </div>
          )}
        </div>
        <button className={`filter-button ${onlyOpen ? 'active' : ''}`} onClick={() => setFilterOpen((value) => !value)} aria-label={t.filterPlaces}>
          <SlidersHorizontal size={19} /><span>{t.filters}</span>{onlyOpen && <i />}
        </button>
        {filterOpen && (
          <div className="filter-popover">
            <div><strong>{t.showOnMap}</strong><span>{placesCountLabel(visiblePlaces.length, t)}</span></div>
            <button onClick={() => setOnlyOpen((value) => !value)}>
              <span className={`checkbox ${onlyOpen ? 'checked' : ''}`}>{onlyOpen && <Check size={13} />}</span>
              {t.onlyOpen}
            </button>
          </div>
        )}
      </section>

      <section className="workspace">
        <aside className="desktop-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">{todayLabel}</span><h1>{currentMap ? `${t.yourItinerary} ${currentMap}` : t.firstItinerary}</h1><p>{placesCountLabel(visiblePlaces.length, t)}</p></div>
          </div>
          {currentMap && visiblePlaces.length > 0 && <div className="progress-card"><span><Sparkles size={15} /> {openPlacesCount > 0 ? t.goodTime : t.planStop}</span><p>{exploreSummary(openPlacesCount, soonPlacesCount, t)}</p><div className="status-summary"><span><i className="open" />{openPlacesCount} {openPlacesCount === 1 ? t.openSingular : t.openPlural}</span><span><i className="soon" />{soonPlacesCount} {t.soon}</span></div></div>}
          <div className="place-list desktop-list">
            {visiblePlaces.map((place) => <PlaceRow key={place.id} place={place} active={place.id === selectedId} mapsReady={mapsStatus === 'ready'} language={language} onSelect={() => showPlace(place.id)} />)}
          </div>
          {currentMap && visiblePlaces.length === 0 && <div className="panel-empty"><MapPin size={22} /><strong>{t.emptyItinerary}</strong><span>{t.emptyItineraryHint}</span></div>}
          <button className="add-place-button" onClick={() => currentMap ? (setQuery(''), searchInputRef.current?.focus()) : setMapsOpen(true)}><Plus size={18} /> {currentMap ? t.addFromMaps : t.createFirstMap}</button>
        </aside>

        <div className={`map-area ${view === 'list' ? 'mobile-list-view' : ''}`}>
          <div className={`map-canvas ${mapsStatus === 'ready' ? 'map-canvas-hidden' : ''}`} style={{ '--map-scale': zoom } as React.CSSProperties}>
            <div className="map-text label-sol">SOL</div><div className="map-text label-retiro">RETIRO</div>
            <div className="map-text street-one">Calle de Alcalá</div><div className="map-text street-two">Gran Vía</div>
            <div className="park park-one" /><div className="park park-two" /><div className="water" />
            <div className="user-location" aria-label={t.yourLocation}><span /><i /><em>{locationLabel}</em></div>
            {visiblePlaces.map((place) => (
              <button key={place.id} className={`map-marker ${place.status} ${selectedId === place.id ? 'selected' : ''}`}
                style={{ left: `${place.x}%`, top: `${place.y}%`, background: getPinColor(place) }} onClick={() => showPlace(place.id)}
                aria-label={`${place.name}: ${place.statusLabel}`}>
                <span>{place.category === 'Restaurante' ? 'R' : place.category === 'Parque' ? 'P' : '◆'}</span>
              </button>
            ))}
            {visiblePlaces.length === 0 && <div className="empty-map"><Search size={24} /><strong>{currentMap ? t.noPlaceFound : t.createFirstMap}</strong><span>{currentMap ? t.removeFilters : t.organizeTrip}</span></div>}
          </div>
          {mapsStatus === 'ready' && storageReady && themeReady && <LiveGoogleMap places={visiblePlaces} selectedId={selectedId} onSelect={showPlace} onMapPlaceClick={selectPlaceFromMap} onUserPosition={updateUserPosition} onMapReady={setLiveMap} trackUser={trackLocation} userPosition={userPosition} language={language} theme={theme} />}
          {mapsStatus !== 'ready' && <MapsConnection status={mapsStatus} error={mapsError} onConnect={connectGoogleMaps} language={language} />}
          {mapsStatus === 'ready' && <div className="map-add-hint"><Plus size={15} /> {t.tapMapToAdd}</div>}
          {mapPlaceLoading && <div className="maps-connect-card compact map-place-loading"><span className="search-spinner" /><strong>{t.loadingPlace}</strong></div>}
          <div className="map-controls"><button onClick={() => liveMap ? liveMap.setZoom(Math.min(20, (liveMap.getZoom() ?? 13) + 1)) : setZoom((value) => Math.min(1.14, value + .04))} aria-label={t.zoomIn}>+</button><button onClick={() => liveMap ? liveMap.setZoom(Math.max(2, (liveMap.getZoom() ?? 13) - 1)) : setZoom((value) => Math.max(.9, value - .04))} aria-label={t.zoomOut}>−</button></div>
          <button className={`locate-button ${isLocating ? 'locating' : ''}`} onClick={useMyLocation} aria-label={t.centerLocation} title={t.centerLocation} disabled={mapsStatus !== 'ready'}><LocateFixed size={21} /></button>

          <div className="mobile-list">
            <div className="mobile-list-heading">
              <div><span className="eyebrow">{todayLabel}</span><h2>{currentMap ? `${t.yourItinerary} ${currentMap}` : t.firstItinerary}</h2></div>
              <span>{placesCountLabel(visiblePlaces.length, t)}</span>
            </div>
            {currentMap && visiblePlaces.length > 0 && (
              userPosition
                ? <div className="distance-sort-state ready"><Navigation size={13} /> {t.nearestFirst}</div>
                : <button className="distance-sort-state" onClick={useMyLocation} disabled={isLocating}><LocateFixed size={13} /> {isLocating ? t.calculatingDistances : t.enableDistance}</button>
            )}
            <div className="place-list">{visiblePlaces.map((place) => <PlaceRow key={place.id} place={place} active={place.id === selectedId} mapsReady={mapsStatus === 'ready'} language={language} onSelect={() => { showPlace(place.id); setView('map'); }} />)}</div>
            {visiblePlaces.length === 0 && <div className="panel-empty mobile-empty"><MapPin size={22} /><strong>{t.noPlaceItinerary}</strong><span>{t.returnMapHint}</span></div>}
          </div>

          {view === 'map' && !detailsDismissed && visiblePlaces.some((place) => place.id === selected.id) && (
            <article className="place-card">
              <button className="close-card" onClick={closePlaceDetails} aria-label={t.closeDetails} title={t.closeDetails}><X size={18} /></button>
              <div className="place-photo">
                <span className="photo-placeholder"><MapPin size={30} /></span>
                {selected.photo && <img src={selected.photo} alt={`${t.photoOf} ${selected.name}`} />}
                {mapsStatus === 'ready' && <GooglePlacePhoto placeId={selected.placeId} name={selected.name} />}
                <span className={`status-pill ${selected.status}`}><i />{localizedStatusLabel(selected.statusLabel, language)}</span><span className="rating"><Star size={13} fill="currentColor" /> {selected.rating}</span>
                {selected.photoAttribution && <a className="photo-credit" href={selected.photoAttribution.url} target="_blank" rel="noreferrer">{t.photo}: {selected.photoAttribution.name}</a>}
              </div>
              <div className="place-content">
                <div className="place-title"><div><span>{localizedCategory(selected.category, language)}</span><h2>{selected.name}</h2></div><strong>{selected.distance}</strong></div>
                <div className="meta-row"><MapPin size={16} /><span>{selected.address}</span></div>
                <div className="meta-row"><Clock3 size={16} /><span><strong>{localizedStatusLabel(selected.statusLabel, language)}</strong> · {t.today}, {localizedHours(selected.hours, language)}</span></div>
                <div className="pin-color-picker"><span>{t.pinColor}</span><div role="group" aria-label={t.choosePinColor}>
                  <button className={!selected.pinColor ? 'active auto-color' : 'auto-color'} onClick={() => savePinColor(undefined)} aria-label={t.useAutomaticColor} title={t.automaticColor}><Sparkles size={13} /></button>
                  {pinColorChoices.map(({ color, label }) => <button key={color} className={selected.pinColor === color ? 'active' : ''} style={{ '--choice-color': color } as React.CSSProperties} onClick={() => savePinColor(color)} aria-label={`${t.pinColor}: ${t[label]}`} title={t[label]} />)}
                </div></div>
                <label className="note-field"><span>{t.personalNote}</span><input value={selected.note} onChange={(event) => saveNote(event.target.value)} /></label>
                <div className="place-actions">
                  <button className="remove-place-button" onClick={() => setRemoveConfirmOpen(true)}><Trash2 size={16} /> {t.remove}</button>
                  <button className="go-button" onClick={openRouteOptions}><Navigation size={19} fill="currentColor" /> {t.goMaps}</button>
                </div>
              </div>
            </article>
          )}
        </div>
      </section>

      <nav className="bottom-nav" aria-label={t.mainNavigation}>
        <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}><MapIcon size={21} /><span>{t.map}</span></button>
        <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><Menu size={21} /><span>{t.list}</span></button>
        <button onClick={() => setMapsOpen(true)}><Plus size={22} /><span>{t.newMap}</span></button>
      </nav>

      {authOpen && (
        <div className="modal-backdrop auth-backdrop" onClick={() => setAuthOpen(false)}>
          <section className="auth-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <div className="modal-heading"><div><span>{t.yourAccount}</span><h2 id="auth-title">{authUser ? t.syncedItineraries : t.enterRoamly}</h2></div><button onClick={() => setAuthOpen(false)} aria-label={t.close}><X size={19} /></button></div>
            {authUser ? (
              <>
                <div className="account-card"><span className="account-avatar">{userInitials(authUser.name)}</span><span><strong>{authUser.name}</strong><small>{authUser.email}</small></span></div>
                <div className={`account-sync ${syncStatus}`}><ShieldCheck size={18} /><span><strong>{syncStatus === 'synced' ? t.cloudSaved : syncStatus === 'error' ? t.couldNotSync : t.syncingItineraries}</strong><small>{t.linkedGoogle}</small></span></div>
                <button className="logout-button" onClick={logout}><LogOut size={17} /> {t.logout}</button>
              </>
            ) : (
              <>
                <p className="auth-copy">{t.accessEverywhere}</p>
                <div ref={googleButtonRef} className="google-login-button" />
                {authLoading && <div className="auth-loading"><span className="search-spinner" /> {t.preparingLogin}</div>}
                {authError && <p className="auth-error">{authError}</p>}
                {!oauthClientId && !authLoading && <p className="auth-error">{t.googleNotConfigured}</p>}
                <p className="auth-privacy"><ShieldCheck size={14} /> {t.googlePrivacy}</p>
              </>
            )}
          </section>
        </div>
      )}

      {routeOpen && (
        <div className="modal-backdrop" onClick={() => setRouteOpen(false)}>
          <section className="route-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={t.chooseTransport}>
            <div className="sheet-handle" />
            <div className="sheet-heading"><div><span>{t.routeTo}</span><h2>{selected.name}</h2><p>{t.leavingLocation}</p></div><button onClick={() => setRouteOpen(false)} aria-label={t.close}><X size={19} /></button></div>
            <div className="travel-grid">
              <button onClick={() => openDirections('walking')}><Footprints size={24} /><strong>{t.walk}</strong><span>{t.openRoute}</span></button>
              <button onClick={() => openDirections('driving')}><Car size={24} /><strong>{t.car}</strong><span>{t.openRoute}</span></button>
              <button onClick={() => openDirections('bicycling')}><Bike size={24} /><strong>{t.bike}</strong><span>{t.openRoute}</span></button>
              <button onClick={() => openDirections('transit')}><BusFront size={24} /><strong>{t.transit}</strong><span>{t.openRoute}</span></button>
            </div><p className="google-note">{t.routeOpensMaps}</p>
          </section>
        </div>
      )}

      {removeConfirmOpen && selected && (
        <div className="modal-backdrop" onClick={() => setRemoveConfirmOpen(false)}>
          <section className="confirm-modal" onClick={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="remove-place-title" aria-describedby="remove-place-description">
            <span className="confirm-icon"><Trash2 size={23} /></span>
            <div><span className="eyebrow">{t.removeFromItinerary}</span><h2 id="remove-place-title">{language === 'es' ? `${t.removeQuestion} ${selected.name}?` : `${t.removeQuestion} ${selected.name}?`}</h2><p id="remove-place-description">{t.removeDescription}</p></div>
            <div className="confirm-actions"><button onClick={() => setRemoveConfirmOpen(false)}>{t.cancel}</button><button className="confirm-remove" onClick={removeSelectedPlace}><Trash2 size={16} /> {t.removePlace}</button></div>
          </section>
        </div>
      )}

      {mapsOpen && (
        <div className="modal-backdrop" onClick={() => setMapsOpen(false)}>
          <section className="maps-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={t.yourMaps}>
            <div className="modal-heading"><div><span>{t.yourMaps}</span><h2>{t.whereTo}</h2></div><button onClick={() => setMapsOpen(false)} aria-label={t.close}><X size={19} /></button></div>
            {maps.length === 0 && <div className="places-unavailable maps-empty"><MapIcon size={23} /><strong>{t.noMaps}</strong><span>{t.noMapsHint}</span></div>}
            {maps.map((mapName, index) => (
              <div className="map-option-row" key={mapName}>
                <button className={`map-option ${currentMap === mapName ? 'selected' : ''}`} onClick={() => openMap(mapName)}>
                  <span className={`map-thumb ${index === 0 ? 'madrid' : 'lisbon'}`}>{mapName.slice(0,3).toUpperCase()}</span>
                  <span><strong>{mapName}</strong><small>{savedPlacesLabel(places.filter((place) => (place.destination ?? 'Madri') === mapName).length, t)}</small></span>
                  {currentMap === mapName && <Check size={19} />}
                </button>
                <button className="delete-map-button" onClick={() => setMapPendingDelete(mapName)} aria-label={`${t.deleteMap} ${mapName}`} title={`${t.deleteMap} ${mapName}`}><Trash2 size={17} /></button>
              </div>
            ))}
            <div className="new-map-form"><label htmlFor="new-map">{t.newDestination}</label><div><input id="new-map" value={newMapName} onChange={(event) => setNewMapName(event.target.value)} placeholder={t.destinationExample} onKeyDown={(event) => event.key === 'Enter' && createMap()} /><button onClick={createMap}><Plus size={18} /> {t.createMap}</button></div></div>
          </section>
        </div>
      )}
      {mapPlaceCandidate && (
        <div className="modal-backdrop map-place-backdrop" onClick={() => setMapPlaceCandidate(null)}>
          <section className="maps-modal map-place-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="map-place-title">
            <div className="modal-heading"><div><span>{t.mapsPlace}</span><h2 id="map-place-title">{t.addItinerary}</h2></div><button onClick={() => setMapPlaceCandidate(null)} aria-label={t.close}><X size={19} /></button></div>
            <div className="map-place-preview">
              <span className="map-place-photo"><MapPin size={24} />{mapPlaceCandidate.photo && <img src={mapPlaceCandidate.photo} alt="" />}</span>
              <span><strong>{mapPlaceCandidate.name}</strong><small>{mapPlaceCandidate.address}</small><em>{localizedCategory(mapPlaceCandidate.category, language)} · {localizedStatusLabel(mapPlaceCandidate.statusLabel, language)}</em>{mapPlaceCandidate.photoAttribution && <a href={mapPlaceCandidate.photoAttribution.url} target="_blank" rel="noreferrer">{t.photo}: {mapPlaceCandidate.photoAttribution.name}</a>}</span>
            </div>
            <div className="confirm-actions map-place-actions"><button onClick={() => setMapPlaceCandidate(null)}>{t.cancel}</button><button className="confirm-add" onClick={addMapPlaceCandidate}><Plus size={16} /> {t.addMap}</button></div>
            <div className="google-attribution modal-google"><img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" /></div>
          </section>
        </div>
      )}
      {mapPendingDelete && (
        <div className="modal-backdrop map-delete-backdrop" onClick={() => setMapPendingDelete(null)}>
          <section className="confirm-modal" onClick={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="delete-map-title" aria-describedby="delete-map-description">
            <span className="confirm-icon"><Trash2 size={23} /></span>
            <div><span className="eyebrow">{t.deleteMap.toLocaleUpperCase(locale)}</span><h2 id="delete-map-title">{t.deleteMap} {mapPendingDelete}?</h2><p id="delete-map-description">{t.deleteMapDescription}</p></div>
            <div className="confirm-actions"><button onClick={() => setMapPendingDelete(null)}>{t.cancel}</button><button className="confirm-remove" onClick={deleteMap}><Trash2 size={16} /> {t.deleteMap}</button></div>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    </main>
  );
}

function GooglePlacePhoto({ placeId, name, className = '' }: { placeId: string; name: string; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !window.google?.maps?.importLibrary) return;
    let cancelled = false;
    host.classList.remove('loaded');

    void google.maps.importLibrary('places').then(() => {
      if (cancelled) return;
      const details = document.createElement('gmp-place-details-compact');
      details.setAttribute('orientation', 'vertical');
      details.setAttribute('truncation-preferred', '');
      details.setAttribute('aria-label', `Primeira foto de ${name} no Google Maps`);
      details.style.cssText = 'display:block;width:100%;height:100%;padding:0;margin:0;border:0;background:transparent;color-scheme:light;';
      details.addEventListener('gmp-load', () => {
        if (!cancelled) host.classList.add('loaded');
      }, { once: true });

      const request = document.createElement('gmp-place-details-place-request');
      request.setAttribute('place', placeId);
      const content = document.createElement('gmp-place-content-config');
      const media = document.createElement('gmp-place-media');
      media.setAttribute('preferred-size', 'large');
      const attribution = document.createElement('gmp-place-attribution');
      attribution.setAttribute('light-scheme-color', 'white');
      attribution.setAttribute('dark-scheme-color', 'white');
      content.appendChild(media);
      content.appendChild(attribution);
      details.appendChild(request);
      details.appendChild(content);
      host.replaceChildren(details);
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      host.classList.remove('loaded');
      host.replaceChildren();
    };
  }, [name, placeId]);

  return <div ref={hostRef} className={`google-place-photo ${className}`} />;
}

function PlaceRow({ place, active, mapsReady, language, onSelect }: { place: Place; active: boolean; mapsReady: boolean; language: Language; onSelect: () => void }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const t = translations[language];

  useEffect(() => setPhotoFailed(false), [place.photo, place.placeId]);

  return (
    <button className={`place-row ${active ? 'active' : ''}`} onClick={onSelect}>
      <span className="row-photo">
        <MapPin size={19} />
        {place.photo && !photoFailed && <img src={place.photo} alt={`${t.photoOf} ${place.name}`} loading="lazy" onError={() => setPhotoFailed(true)} />}
        {mapsReady && (!place.photo || photoFailed) && <GooglePlacePhoto placeId={place.placeId} name={place.name} className="row-google-photo" />}
        <i className={place.status} />
      </span>
      <span className="row-copy">
        <strong>{place.name}</strong>
        <small>{localizedCategory(place.category, language)}</small>
        <span className={`row-distance ${place.distance === '—' ? 'pending' : ''}`}><Navigation size={11} />{place.distance === '—' ? t.distancePending : place.distance}</span>
        <em className={place.status}>{localizedStatusLabel(place.statusLabel, language)}</em>
      </span>
      <span className={`status-dot ${place.status}`} title={place.status === 'open' ? t.openStatus : place.status === 'soon' ? t.soonStatus : t.closedStatus} />
    </button>
  );
}

const placeFields = [
  'id', 'displayName', 'formattedAddress', 'location', 'primaryType', 'primaryTypeDisplayName',
  'rating', 'photos', 'currentOpeningHours', 'regularOpeningHours', 'utcOffsetMinutes',
];

type TravelMode = 'walking' | 'driving' | 'bicycling' | 'transit';

function getDirectionsUrl(place: Place, mode: TravelMode) {
  const params = new URLSearchParams({
    api: '1',
    destination: place.name,
    destination_place_id: place.placeId,
    travelmode: mode,
    dir_action: 'navigate',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function loadGoogleMaps(apiKey: string, language: Language) {
  const runtimeWindow = window as Window & { google?: typeof google; __roamlyGoogleMapsReady?: () => void };
  const existingGoogle = runtimeWindow.google;
  if (existingGoogle?.maps?.Map) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-roamly-google-maps]');
    if (existing) {
      const poll = window.setInterval(() => { if (runtimeWindow.google?.maps?.Map) { window.clearInterval(poll); resolve(); } }, 120);
      window.setTimeout(() => { window.clearInterval(poll); reject(new Error('O Google Maps demorou demais para responder.')); }, 15_000);
      return;
    }
    const script = document.createElement('script');
    script.dataset.roamlyGoogleMaps = 'true';
    script.async = true;
    const timeout = window.setTimeout(() => reject(new Error('O Google Maps demorou demais para responder.')), 15_000);
    runtimeWindow.__roamlyGoogleMapsReady = () => { window.clearTimeout(timeout); delete runtimeWindow.__roamlyGoogleMapsReady; resolve(); };
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&language=${encodeURIComponent(languageLocales[language])}&region=BR&libraries=places,marker&callback=__roamlyGoogleMapsReady`;
    script.onerror = () => reject(new Error('Falha ao carregar o Google Maps. Confira a chave e as APIs habilitadas.'));
    document.head.appendChild(script);
  });
}

function LiveGoogleMap({
  places, selectedId, onSelect, onMapPlaceClick, onUserPosition, onMapReady, trackUser, userPosition, language, theme,
}: {
  places: Place[]; selectedId: string; onSelect: (id: string) => void;
  onMapPlaceClick: (placeId: string) => void;
  onUserPosition: (position: google.maps.LatLngLiteral) => void;
  onMapReady: (map: google.maps.Map) => void;
  trackUser: boolean;
  userPosition: google.maps.LatLngLiteral | null;
  language: Language;
  theme: Theme;
}) {
  const t = translations[language];
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<ReturnType<typeof createMarkerRegistry> | null>(null);
  const userMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const onMapPlaceClickRef = useRef(onMapPlaceClick);
  const onSelectRef = useRef(onSelect);
  const initialPlacesRef = useRef(places);
  const viewportRef = useRef<{ center: google.maps.LatLngLiteral; zoom: number; heading: number; tilt: number } | null>(null);

  useEffect(() => { onMapPlaceClickRef.current = onMapPlaceClick; }, [onMapPlaceClick]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const first = initialPlacesRef.current.find((place) => place.lat != null && place.lng != null);
    const map = new google.maps.Map(container, {
      center: first?.lat != null && first.lng != null ? { lat: first.lat, lng: first.lng } : { lat: 40.4168, lng: -3.7038 },
      zoom: 14, mapId: 'DEMO_MAP_ID', disableDefaultUI: true, clickableIcons: true,
      ...viewportRef.current,
      // Google only accepts colorScheme at initialization. Preserve the camera
      // when the user explicitly changes theme, never recreate it for GPS updates.
      colorScheme: theme === 'dark' ? 'DARK' : 'LIGHT',
      gestureHandling: 'greedy', backgroundColor: theme === 'dark' ? '#17221d' : '#edf0e9',
    });
    const clickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
      const iconEvent = event as google.maps.IconMouseEvent;
      if (!iconEvent.placeId) return;
      iconEvent.stop();
      onMapPlaceClickRef.current(iconEvent.placeId);
    });
    markersRef.current = createMarkerRegistry(map, (id) => onSelectRef.current(id));
    mapRef.current = map; onMapReady(map);
    return () => {
      const center = map.getCenter()?.toJSON();
      if (center) viewportRef.current = { center, zoom: map.getZoom() ?? 14, heading: map.getHeading() ?? 0, tilt: map.getTilt() ?? 0 };
      clickListener.remove();
      markersRef.current?.clear();
      markersRef.current = null;
      if (userMarkerRef.current) userMarkerRef.current.map = null;
      userMarkerRef.current = null;
      google.maps.event.clearInstanceListeners(map);
      mapRef.current = null;
      container.replaceChildren();
    };
  }, [onMapReady, theme]);

  useEffect(() => {
    markersRef.current?.update(places.filter((place) => place.lat != null && place.lng != null).map((place) => ({
      id: place.id, lat: place.lat!, lng: place.lng!,
      title: `${place.name} — ${localizedStatusLabel(place.statusLabel, language)}`,
      color: getPinColor(place), glyph: place.category === 'Restaurante' ? 'R' : place.category === 'Parque' ? 'P' : '•',
      selected: place.id === selectedId,
    })));
  }, [places, selectedId, language, theme]);

  useEffect(() => {
    if (!trackUser || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition((position) => {
      onUserPosition({ lat: position.coords.latitude, lng: position.coords.longitude });
    }, () => undefined, { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [onUserPosition, trackUser]);

  useEffect(() => {
    if (!userPosition || !mapRef.current) return;
    if (!userMarkerRef.current) {
      const dot = document.createElement('div');
      dot.className = 'live-user-marker';
      userMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({ map: mapRef.current, position: userPosition, title: t.liveLocation, content: dot, zIndex: 50 });
    } else {
      userMarkerRef.current.position = userPosition;
      userMarkerRef.current.title = t.liveLocation;
    }
  }, [userPosition, t.liveLocation, theme]);

  return <div ref={containerRef} className="live-google-map" aria-label={t.liveMapLabel} />;
}

function MapsConnection({ status, error, onConnect, language }: { status: MapsStatus; error: string; onConnect: (key: string) => void; language: Language }) {
  const [key, setKey] = useState('');
  const t = translations[language];
  if (status === 'loading') return <div className="maps-connect-card compact"><span className="search-spinner" /><strong>{t.mapsLoading}</strong></div>;
  return (
    <div className="maps-connect-card">
      <span className="google-badge"><MapIcon size={23} /></span>
      <div><small>{t.liveMap}</small><h2>{t.connectMaps}</h2><p>{t.mapsKeyHelp}</p></div>
      {error && <p className="maps-error">{error}</p>}
      <div className="key-form"><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={t.pasteMapsKey} aria-label={t.mapsKey} onKeyDown={(event) => event.key === 'Enter' && onConnect(key)} /><button onClick={() => onConnect(key)}>{t.connect}</button></div>
      <span className="key-note">{t.mapsKeyNote}</span>
    </div>
  );
}

async function hydrateModernPlace(ModernPlace: typeof google.maps.places.Place, savedPlace: Place, userPosition: google.maps.LatLngLiteral | null, language: Language) {
  const livePlace = new ModernPlace({ id: savedPlace.placeId, requestedLanguage: languageLocales[language] });
  await livePlace.fetchFields({ fields: placeFields });
  return toSavedPlace(livePlace, savedPlace.destination ?? 'Madri', savedPlace.note, savedPlace.id, userPosition, language);
}

async function hydrateModernPlaceFromPrediction(prediction: google.maps.places.PlacePrediction, destination: string, userPosition: google.maps.LatLngLiteral | null, language: Language) {
  const livePlace = prediction.toPlace();
  await livePlace.fetchFields({ fields: placeFields });
  return toSavedPlace(livePlace, destination, '', `${livePlace.id}-${destination}`, userPosition, language);
}

async function hydratePlaceById(savedPlace: Place, userPosition: google.maps.LatLngLiteral | null, language: Language) {
  const ModernPlace = (google.maps.places as unknown as { Place?: typeof google.maps.places.Place }).Place;
  if (ModernPlace) {
    return hydrateModernPlace(ModernPlace, savedPlace, userPosition, language);
  }
  return toSavedLegacyPlace(await fetchLegacyPlaceDetails(savedPlace.placeId), savedPlace.destination ?? 'Madri', savedPlace.note, savedPlace.id, userPosition, language);
}

async function hydratePrediction(prediction: SearchPrediction, destination: string, userPosition: google.maps.LatLngLiteral | null, language: Language) {
  if (prediction.modern) {
    return hydrateModernPlaceFromPrediction(prediction.modern, destination, userPosition, language);
  }
  return toSavedLegacyPlace(await fetchLegacyPlaceDetails(prediction.placeId), destination, '', `${prediction.placeId}-${destination}`, userPosition, language);
}

function fetchLegacyPlaceDetails(placeId: string) {
  return new Promise<google.maps.places.PlaceResult>((resolve, reject) => {
    const service = new google.maps.places.PlacesService(document.createElement('div'));
    service.getDetails({
      placeId,
      fields: ['place_id', 'name', 'formatted_address', 'geometry', 'opening_hours', 'photos', 'rating', 'types', 'utc_offset_minutes', 'url', 'business_status'],
    }, (result, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && result) resolve(result);
      else reject(new Error('O Google Places não conseguiu carregar os dados deste lugar.'));
    });
  });
}

function toSavedLegacyPlace(result: google.maps.places.PlaceResult, destination: string, note: string, id: string, userPosition: google.maps.LatLngLiteral | null, language: Language): Place {
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
    x: 50, y: 50, rating: result.rating?.toLocaleString(languageLocales[language], { minimumFractionDigits: 1, maximumFractionDigits: 1 }) || '—',
    lat: location?.lat, lng: location?.lng, googleMapsURI: result.url,
  };
}

function getLegacySchedule(openingHours: google.maps.places.PlaceOpeningHours | undefined, utcOffsetMinutes: number, language: Language): { status: PlaceStatus; label: string; hours: string } {
  if (!openingHours?.periods?.length) return unavailableSchedule(language);
  const localNow = new Date(Date.now() + utcOffsetMinutes * 60_000);
  const nowMinutes = localNow.getUTCDay() * 1440 + localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  const week = 7 * 1440;
  const periods = openingHours.periods.map((period) => {
    const start = period.open.day * 1440 + period.open.hours * 60 + period.open.minutes;
    let end = period.close ? period.close.day * 1440 + period.close.hours * 60 + period.close.minutes : start + week;
    if (end <= start) end += week;
    return { start, end, open: period.open, close: period.close };
  });
  const current = periods.find((period) => (nowMinutes >= period.start && nowMinutes < period.end) || (nowMinutes + week >= period.start && nowMinutes + week < period.end));
  const todaysPeriod = periods.find((period) => period.open.day === localNow.getUTCDay());
  const hours = todaysPeriod ? `${formatClock(todaysPeriod.open.hours, todaysPeriod.open.minutes)} – ${todaysPeriod.close ? formatClock(todaysPeriod.close.hours, todaysPeriod.close.minutes) : '24h'}` : closedToday(language);
  if (current) {
    const comparableNow = nowMinutes < current.start ? nowMinutes + week : nowMinutes;
    const remaining = current.end - comparableNow;
    return remaining <= 60 ? { status: 'soon', label: closesIn(remaining, language), hours } : { status: 'open', label: openNow(language), hours };
  }
  const next = periods.map((period) => ({ ...period, wait: (period.start - nowMinutes + week) % week })).filter((period) => period.wait > 0).sort((a, b) => a.wait - b.wait)[0];
  if (!next) return { status: 'closed', label: translations[language].closedStatus, hours };
  return next.wait <= 60 ? { status: 'soon', label: opensIn(next.wait, language), hours } : { status: 'closed', label: opensAt(formatClock(next.open.hours, next.open.minutes), language), hours };
}

const categoryTranslations: Record<Language, Record<string, string>> = {
  pt: { restaurant: 'Restaurante', spanish_restaurant: 'Restaurante espanhol', museum: 'Museu', art_museum: 'Museu de arte', park: 'Parque', tourist_attraction: 'Atração', historical_landmark: 'Marco histórico', lodging: 'Hotel', hotel: 'Hotel', cafe: 'Café', bar: 'Bar', store: 'Loja', shopping_mall: 'Shopping', church: 'Igreja', castle: 'Castelo', garden: 'Jardim', performing_arts_theater: 'Teatro', stadium: 'Estádio', history_culture: 'História & cultura' },
  es: { restaurant: 'Restaurante', spanish_restaurant: 'Restaurante español', museum: 'Museo', art_museum: 'Museo de arte', park: 'Parque', tourist_attraction: 'Atracción', historical_landmark: 'Monumento histórico', lodging: 'Alojamiento', hotel: 'Hotel', cafe: 'Cafetería', bar: 'Bar', store: 'Tienda', shopping_mall: 'Centro comercial', church: 'Iglesia', castle: 'Castillo', garden: 'Jardín', performing_arts_theater: 'Teatro', stadium: 'Estadio', history_culture: 'Historia y cultura' },
  en: { restaurant: 'Restaurant', spanish_restaurant: 'Spanish restaurant', museum: 'Museum', art_museum: 'Art museum', park: 'Park', tourist_attraction: 'Attraction', historical_landmark: 'Historical landmark', lodging: 'Lodging', hotel: 'Hotel', cafe: 'Cafe', bar: 'Bar', store: 'Store', shopping_mall: 'Shopping mall', church: 'Church', castle: 'Castle', garden: 'Garden', performing_arts_theater: 'Theater', stadium: 'Stadium', history_culture: 'History & culture' },
};

function genericPlace(language: Language) { return language === 'es' ? 'Lugar' : language === 'en' ? 'Place' : 'Lugar'; }
function unnamedPlace(language: Language) { return language === 'es' ? 'Lugar sin nombre' : language === 'en' ? 'Unnamed place' : 'Lugar sem nome'; }
function missingAddress(language: Language) { return language === 'es' ? 'Dirección no disponible' : language === 'en' ? 'Address unavailable' : 'Endereço não informado'; }
function closedToday(language: Language) { return language === 'es' ? 'Cerrado hoy' : language === 'en' ? 'Closed today' : 'Fechado hoje'; }
function openNow(language: Language) { return language === 'es' ? 'Abierto ahora' : language === 'en' ? 'Open now' : 'Aberto agora'; }
function closesIn(minutes: number, language: Language) { return language === 'es' ? `Cierra en ${minutes} min` : language === 'en' ? `Closes in ${minutes} min` : `Fecha em ${minutes} min`; }
function opensIn(minutes: number, language: Language) { return language === 'es' ? `Abre en ${minutes} min` : language === 'en' ? `Opens in ${minutes} min` : `Abre em ${minutes} min`; }
function opensAt(time: string, language: Language) { return language === 'es' ? `Abre a las ${time}` : language === 'en' ? `Opens at ${time}` : `Abre às ${time}`; }
function unavailableSchedule(language: Language): { status: PlaceStatus; label: string; hours: string } {
  return language === 'es' ? { status: 'closed', label: 'Horario no disponible', hours: 'Consulta Google Maps' } : language === 'en' ? { status: 'closed', label: 'Hours unavailable', hours: 'Check Google Maps' } : { status: 'closed', label: 'Horário não informado', hours: 'Consulte o Google Maps' };
}

const categoryAliases: Record<string, string> = {
  'história & cultura': 'history_culture', 'historia y cultura': 'history_culture', 'history & culture': 'history_culture',
  restaurante: 'restaurant', restaurant: 'restaurant', museo: 'museum', museu: 'museum', museum: 'museum',
  'museu de arte': 'art_museum', 'museo de arte': 'art_museum', 'art museum': 'art_museum',
  parque: 'park', park: 'park', atração: 'tourist_attraction', atracción: 'tourist_attraction', attraction: 'tourist_attraction',
  'marco histórico': 'historical_landmark', 'monumento histórico': 'historical_landmark', 'historical landmark': 'historical_landmark',
  hotel: 'hotel', café: 'cafe', cafeteria: 'cafe', cafe: 'cafe', bar: 'bar', loja: 'store', tienda: 'store', store: 'store',
  shopping: 'shopping_mall', 'centro comercial': 'shopping_mall', 'shopping mall': 'shopping_mall', igreja: 'church', iglesia: 'church', church: 'church',
  castelo: 'castle', castillo: 'castle', castle: 'castle', jardim: 'garden', jardín: 'garden', garden: 'garden', teatro: 'performing_arts_theater', theater: 'performing_arts_theater', estádio: 'stadium', estadio: 'stadium', stadium: 'stadium',
};

function localizedCategory(category: string, language: Language) {
  const key = categoryAliases[category.trim().toLocaleLowerCase(languageLocales[language])];
  return key ? categoryTranslations[language][key] : category;
}

function localizedStatusLabel(label: string, language: Language) {
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

function localizedHours(hours: string, language: Language) {
  if (/fechado hoje|cerrado hoy|closed today/i.test(hours)) return closedToday(language);
  if (/consulte o google maps|consulta google maps|check google maps/i.test(hours)) return unavailableSchedule(language).hours;
  return hours;
}

function formatPlaceType(type: string | undefined, language: Language) {
  if (!type) return genericPlace(language);
  const known = categoryTranslations[language];
  return known[type] || type.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function parseLegacyAttribution(html?: string): { name: string; url: string } | undefined {
  if (!html) return undefined;
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const link = documentNode.querySelector('a');
  return link?.href ? { name: link.textContent?.trim() || 'Google Maps', url: link.href } : undefined;
}

function toSavedPlace(livePlace: google.maps.places.Place, destination: string, note: string, id: string, userPosition: google.maps.LatLngLiteral | null, language: Language): Place {
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
    photoAttribution: attribution?.uri ? { name: attribution.displayName, url: attribution.uri } : undefined,
    x: 50, y: 50, rating: livePlace.rating?.toLocaleString(languageLocales[language], { minimumFractionDigits: 1, maximumFractionDigits: 1 }) || '—',
    lat: location?.lat, lng: location?.lng, googleMapsURI: livePlace.googleMapsURI ?? undefined,
  };
}

function getLiveSchedule(openingHours: google.maps.places.OpeningHours | null | undefined, utcOffsetMinutes: number, language: Language): { status: PlaceStatus; label: string; hours: string } {
  if (!openingHours?.periods?.length) return unavailableSchedule(language);
  const localNow = new Date(Date.now() + utcOffsetMinutes * 60_000);
  const nowMinutes = localNow.getUTCDay() * 1440 + localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  const week = 7 * 1440;
  const periods = openingHours.periods.map((period) => {
    const start = period.open.day * 1440 + period.open.hour * 60 + period.open.minute;
    let end = period.close ? period.close.day * 1440 + period.close.hour * 60 + period.close.minute : start + week;
    if (end <= start) end += week;
    return { start, end, open: period.open, close: period.close };
  });
  const current = periods.find((period) => (nowMinutes >= period.start && nowMinutes < period.end) || (nowMinutes + week >= period.start && nowMinutes + week < period.end));
  const todaysPeriod = periods.find((period) => period.open.day === localNow.getUTCDay());
  const hours = todaysPeriod ? `${formatClock(todaysPeriod.open.hour, todaysPeriod.open.minute)} – ${todaysPeriod.close ? formatClock(todaysPeriod.close.hour, todaysPeriod.close.minute) : '24h'}` : closedToday(language);
  if (current) {
    const comparableNow = nowMinutes < current.start ? nowMinutes + week : nowMinutes;
    const remaining = current.end - comparableNow;
    return remaining <= 60 ? { status: 'soon', label: closesIn(remaining, language), hours } : { status: 'open', label: openNow(language), hours };
  }
  const next = periods.map((period) => ({ ...period, wait: (period.start - nowMinutes + week) % week })).filter((period) => period.wait > 0).sort((a, b) => a.wait - b.wait)[0];
  if (!next) return { status: 'closed', label: translations[language].closedStatus, hours };
  return next.wait <= 60 ? { status: 'soon', label: opensIn(next.wait, language), hours } : { status: 'closed', label: opensAt(formatClock(next.open.hour, next.open.minute), language), hours };
}

function formatClock(hour: number, minute: number) { return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`; }

function haversineMeters(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) {
  const toRad = (value: number) => value * Math.PI / 180;
  const radius = 6371e3;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistance(meters: number, language: Language) { return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${(meters / 1000).toLocaleString(languageLocales[language], { maximumFractionDigits: 1 })} km`; }

function sortableDistance(place: Place, userPosition: google.maps.LatLngLiteral | null) {
  if (userPosition && place.lat != null && place.lng != null) return haversineMeters(userPosition, { lat: place.lat, lng: place.lng });
  const numericDistance = Number(place.distance.match(/[\d.,]+/)?.[0].replace(',', '.') ?? Number.NaN);
  if (place.distance.endsWith(' km')) return numericDistance * 1000;
  if (place.distance.endsWith(' m')) return numericDistance;
  return Number.POSITIVE_INFINITY;
}

function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  const current = (window as unknown as { google?: { accounts?: { id?: GoogleIdentityApi } } }).google?.accounts?.id;
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-roamly-google-identity]');
    const script = existing ?? document.createElement('script');
    const finish = () => {
      const identity = (window as unknown as { google?: { accounts?: { id?: GoogleIdentityApi } } }).google?.accounts?.id;
      if (identity) resolve(identity); else reject(new Error('Google Identity indisponível'));
    };
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Falha ao carregar Google Identity')), { once: true });
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.roamlyGoogleIdentity = 'true';
      document.head.appendChild(script);
    }
  });
}

async function saveCloudState(maps: string[], currentMap: string, places: Place[]) {
  const response = await fetch('/api/sync', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maps, currentMap, places: dedupePlaces(places), updatedAt: Date.now() }),
  });
  if (!response.ok) throw new Error('Não foi possível sincronizar seus roteiros');
}

function userInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return `${words[0]?.[0] ?? 'G'}${words.length > 1 ? words.at(-1)?.[0] ?? '' : ''}`.toLocaleUpperCase('pt-BR');
}

function getPinColor(place: Place) { return place.pinColor || statusPinColors[place.status]; }

function placesCountLabel(count: number, t: Copy) { return `${count} ${count === 1 ? t.place : t.places}`; }

function savedPlacesLabel(count: number, t: Copy) {
  if (count === 0) return t.noSavedPlace;
  return `${count} ${count === 1 ? t.savedPlace : t.savedPlaces}`;
}

function exploreSummary(openCount: number, soonCount: number, t: Copy) {
  if (openCount === 0 && soonCount === 0) return t.exploreNone;
  const openLabel = `${openCount} ${openCount === 1 ? t.openPlace : t.openPlaces}`;
  if (soonCount > 0) return `${openLabel} ${soonCount} ${t.scheduleChange}`;
  return `${openLabel} ${t.visitNow}`;
}

function formatDateLabel(date: Date, language: Language) {
  const locale = languageLocales[language];
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: '2-digit', month: 'short' })
    .format(date).replace('.', '').toLocaleUpperCase(locale);
}

function formatGoogleError(error: unknown, language: Language) {
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
