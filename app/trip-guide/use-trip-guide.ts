'use client';

/* These effects mirror external storage/provider state; extraction preserves their lifecycle. */
/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { languageLocales, normalizeLanguage, translations, type Copy, type Language } from '../i18n';
import { accountStorage, accountFetch, AccountChangedError, authChallenge, accountChangeKey, announceAccountChange } from '../account-storage';
import { accountIdentity, clearItineraryCache, clearOtherAccountGenerations, withoutDistance } from '../data-privacy';
import { privacyCopy } from '../privacy-copy';
import type { Theme, Place, MapsStatus, AuthUser, SyncStatus, SearchPrediction, TravelMode } from './types';
import { initialPlaces, removedPlacesStorageKey, placeKey, dedupePlaces, restoreLocalItinerary } from './place-model';
import { loadGoogleMaps, loadGoogleIdentity } from './google-runtime';
import { getDirectionsUrl, formatDateLabel } from './formatting';
import { SyncEngine, ConflictChangedError, type SyncResult } from './sync-engine';
import { sameValue, type SyncConflict } from '../itinerary-sync';
import { cachedAccount, offlineAccountKey } from '../offline-account';
import { browserStorage } from '../browser-storage';
import { uxCopy } from './ux-copy';
import { hydratePlaceById, hydratePrediction, haversineMeters, formatDistance, sortableDistance, formatGoogleError, placeAvailability, scheduleIsFresh } from './google-places';
import { freshLocation, locationLifetimeMs } from './location-state';

export function useTripGuide() {
  const [theme, setTheme] = useState<Theme>('light');
  const [themeReady, setThemeReady] = useState(false);
  const [language, setLanguage] = useState<Language>('pt');
  const t: Copy = translations[language];
  const locale = languageLocales[language];
  const [places, setPlaces] = useState(initialPlaces);
  const [selectedId, setSelectedId] = useState('prado');
  const [detailsDismissed, setDetailsDismissed] = useState(false);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'saved' | 'google'>('saved');
  const [filterOpen, setFilterOpen] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [routePlace, setRoutePlace] = useState<Place | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Place | null>(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [mapPendingDelete, setMapPendingDelete] = useState<string | null>(null);
  const [mapsOpen, setMapsOpen] = useState(false);
  const [shareMapName, setShareMapName] = useState<string | null>(null);
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
  const [placesError, setPlacesError] = useState('');
  const [mapsAttempt, setMapsAttempt] = useState(0);
  const [placesAttempt, setPlacesAttempt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [networkOnline, setNetworkOnline] = useState(true);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<SearchPrediction[]>([]);
  const [isSearchingGoogle, setIsSearchingGoogle] = useState(false);
  const [liveMap, setLiveMap] = useState<google.maps.Map | null>(null);
  const [userPosition, setUserPosition] = useState<google.maps.LatLngLiteral | null>(null);
  const [trackLocation, setTrackLocation] = useState(false);
  const [locationAllowed, setLocationAllowed] = useState(false);
  const [mapPlaceCandidate, setMapPlaceCandidate] = useState<Place | null>(null);
  const [mapPlaceLoading, setMapPlaceLoading] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [oauthClientId, setOauthClientId] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [cacheOwner, setCacheOwner] = useState<string | null | undefined>(undefined);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [storageIssue, setStorageIssue] = useState(false);
  const syncEngineRef = useRef<SyncEngine | null>(null);
  const accountActiveRef = useRef(true);
  const accountTransitionRef = useRef(0);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const addingPlaceKeysRef = useRef(new Set<string>());
  const hydratedPlaceKeysRef = useRef(new Set<string>());
  const failedPlaceKeysRef = useRef(new Set<string>());
  const locationAllowedRef = useRef(false);
  const locationRequestRef = useRef(0);
  const locationTimestampRef = useRef(0);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const cloudLoadedForUserRef = useRef('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  function localItineraryStorage() { return accountStorage(browserStorage(), cacheOwner ?? null); }
  function readBrowserItem(key: string) { try { return browserStorage().getItem(key); } catch { setStorageIssue(true); return null; } }

  const reloadForAccountChange = useCallback(() => {
    accountTransitionRef.current += 1;
    accountActiveRef.current = false;
    cloudLoadedForUserRef.current = '';
    window.location.reload();
  }, []);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    setThemeReady(true);
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#14201b' : '#fffdfa');
    try { browserStorage().setItem('roamly-theme', next); } catch { /* Theme still works when storage is unavailable. */ }
    setTheme(next);
  }

  const updateUserPosition = useCallback((next: google.maps.LatLngLiteral, timestamp = Date.now()) => {
    if (!locationAllowedRef.current) return;
    locationTimestampRef.current = timestamp;
    // Ignore sub-metre GPS noise; distances and the blue dot remain live as you move.
    setUserPosition((previous) => previous && haversineMeters(previous, next) < 1 ? previous : next);
  }, []);

  const loseLocation = useCallback(() => { locationTimestampRef.current = 0; setUserPosition(null); }, []);
  useEffect(() => {
    if (!trackLocation || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition((position) => {
      if (!freshLocation(position)) { loseLocation(); return; }
      updateUserPosition({ lat: position.coords.latitude, lng: position.coords.longitude }, position.timestamp);
    }, (error) => {
      loseLocation();
      if (error.code === 1) { locationAllowedRef.current = false; setLocationAllowed(false); setTrackLocation(false); }
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 });
    const expire = () => { if (locationTimestampRef.current && Date.now() - locationTimestampRef.current > locationLifetimeMs) loseLocation(); };
    const timer = window.setInterval(expire, 10_000);
    document.addEventListener('visibilitychange', expire);
    return () => { navigator.geolocation.clearWatch(watch); window.clearInterval(timer); document.removeEventListener('visibilitychange', expire); };
  }, [trackLocation, updateUserPosition, loseLocation]);

  useEffect(() => {
    const savedLanguage = normalizeLanguage(readBrowserItem('roamly-language'));
    setLanguage(savedLanguage);
    setLocationLabel(translations[savedLanguage].yourLocation);
    document.documentElement.lang = languageLocales[savedLanguage];
  }, []);

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    try { browserStorage().setItem('roamly-language', nextLanguage); } catch { setStorageIssue(true); }
    document.documentElement.lang = languageLocales[nextLanguage];
    setLocationLabel(userPosition ? translations[nextLanguage].liveLocation : translations[nextLanguage].yourLocation);
    hydratedPlaceKeysRef.current.clear();
    failedPlaceKeysRef.current.clear();
  }

  const handleGoogleCredential = useCallback(async (response: { credential?: string }) => {
    if (!response.credential) { setAuthError(language === 'es' ? 'Google no devolvió una credencial válida.' : language === 'en' ? 'Google did not return a valid credential.' : 'O Google não retornou uma credencial válida.'); return; }
    setAuthLoading(true);
    setAuthError('');
    try {
      const csrfToken = await authChallenge();
      if (!accountActiveRef.current) return;
      const result = await fetch('/api/auth/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Roamly-CSRF': csrfToken }, body: JSON.stringify({ credential: response.credential }),
      });
      const payload = await result.json() as { user?: AuthUser; error?: string };
      if (!result.ok || !payload.user) throw new Error(payload.error || (language === 'es' ? 'No se pudo iniciar sesión' : language === 'en' ? 'Could not sign in' : 'Não foi possível entrar'));
      announceAccountChange();
      reloadForAccountChange();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : language === 'es' ? 'No se pudo iniciar sesión con Google.' : language === 'en' ? 'Could not sign in with Google.' : 'Não foi possível entrar com o Google.');
    } finally { setAuthLoading(false); }
  }, [language, reloadForAccountChange]);

  useEffect(() => {
    if (cacheOwner === undefined) return;
    try { browserStorage().getItem('roamly-storage-read-check'); } catch { setStorageIssue(true); }
    const restored = restoreLocalItinerary(accountStorage(browserStorage(), cacheOwner), cacheOwner === null);
    syncEngineRef.current = cacheOwner ? new SyncEngine(cacheOwner, browserStorage(), restored, () => accountActiveRef.current && syncEngineRef.current?.owner === cacheOwner) : null;
    setMaps(restored.maps);
    setCurrentMap(restored.currentMap);
    setPlaces(restored.places);
    setStorageReady(true);
  }, [cacheOwner]);

  useLayoutEffect(() => {
    if (!storageReady || cacheOwner === undefined || !accountActiveRef.current) return;
    try {
      syncEngineRef.current?.capture({ maps, currentMap, places });
      if (syncEngineRef.current?.pending().length) setSyncStatus((status) => status === 'conflict' ? status : navigator.onLine ? 'pending' : 'offline');
      const storage = accountStorage(browserStorage(), cacheOwner);
      storage.setItem('roamly-maps', JSON.stringify(maps));
      storage.setItem('roamly-current-map', currentMap);
      storage.setItem('roamly-place-refs', JSON.stringify(dedupePlaces(places).map((place) => ({ ...withoutDistance(place), destination: place.destination ?? 'Madri' }))));
      storage.setItem('roamly-notes', JSON.stringify(Object.fromEntries(places.map((place) => [place.id, place.note]))));
      if (syncEngineRef.current && !syncEngineRef.current.durable) setStorageIssue(true);
    } catch { setStorageIssue(true); }
  }, [maps, places, currentMap, storageReady, cacheOwner]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/google-config').then(async (response) => await response.json() as { apiKey?: string }).catch(() => ({ apiKey: '' })).then((config) => {
      if (cancelled) return;
      setApiKey(config.apiKey || readBrowserItem('roamly-google-maps-key') || '');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/auth/config').then(async (response) => await response.json() as { clientId?: string }).catch(() => ({ clientId: '' })),
      fetch('/api/auth/session', { cache: 'no-store' }).then(async (response) => {
        if (!response.ok) throw new Error('Session unavailable');
        return await response.json() as { user?: AuthUser | null };
      }).catch(() => ({ user: cachedAccount(browserStorage()) })),
    ]).then(([config, session]) => {
      if (cancelled || !accountActiveRef.current) return;
      setOauthClientId(config.clientId ?? '');
      try { if (session.user) browserStorage().setItem(offlineAccountKey, JSON.stringify(session.user)); else browserStorage().removeItem(offlineAccountKey); } catch { /* Queue persistence surfaces storage errors. */ }
      setAuthUser(session.user ?? null);
      setCacheOwner(session.user ? accountIdentity(session.user) : null);
      setAuthLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (cacheOwner === undefined) return;
    let cancelled = false;
    const recheck = async () => {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        if (!response.ok) return;
        const session = await response.json() as { user?: AuthUser | null };
        if (!cancelled && (session.user ? accountIdentity(session.user) : null) !== cacheOwner) reloadForAccountChange();
      } catch { /* Offline edits remain scoped to this account; writes still check the cookie on the server. */ }
    };
    const visibility = () => { if (document.visibilityState === 'visible') void recheck(); };
    const handleAccountChange = (message: unknown) => {
      const detail = message && typeof message === 'object' ? message as { deletedUserId?: string } : {};
      if (detail.deletedUserId && authUser?.id === detail.deletedUserId) { try { clearItineraryCache(browserStorage(), detail.deletedUserId); } catch { setStorageIssue(true); } }
      reloadForAccountChange();
    };
    const storage = (event: StorageEvent) => {
      if (event.key !== accountChangeKey) return;
      try { handleAccountChange(JSON.parse(event.newValue ?? 'null')); } catch { handleAccountChange(null); }
    };
    let channel: BroadcastChannel | null = null;
    try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(accountChangeKey); } catch { /* Cross-tab signaling is best-effort; the session API remains authoritative. */ }
    if (channel) channel.onmessage = (event) => handleAccountChange(event.data);
    window.addEventListener('focus', recheck);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelled = true;
      channel?.close();
      window.removeEventListener('focus', recheck);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [authUser, cacheOwner, reloadForAccountChange]);

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

  const applySyncResult = useCallback((result: SyncResult) => {
    const next = result.data;
    setMaps((previous) => sameValue(previous, next.maps) ? previous : next.maps); setCurrentMap(next.currentMap);
    setPlaces((previous) => {
      const merged = dedupePlaces(next.places).map((place) => {
        const live = previous.find((item) => placeKey(item.placeId, item.destination) === placeKey(place.placeId, place.destination));
        return live?.openingSchedule ? { ...live, note: place.note, pinColor: place.pinColor, destination: place.destination, id: place.id, distance: '—' } : { ...place, distance: '—' };
      });
      return sameValue(previous, merged) ? previous : merged;
    });
    if (result.invalidCount) setToast(uxCopy[language].invalid);
    setSyncConflicts(result.conflicts);
    setStorageIssue(!result.durable);
    setSyncStatus(result.readOnly ? 'error' : result.conflicts.length ? 'conflict' : result.pending ? 'pending' : 'synced');
  }, [language]);

  useEffect(() => {
    if (!authUser || !storageReady || cacheOwner !== accountIdentity(authUser) || cloudLoadedForUserRef.current === accountIdentity(authUser)) return;
    let cancelled = false;
    const owner = accountIdentity(authUser);
    const engine = syncEngineRef.current;
    if (!engine) return;
    try { clearOtherAccountGenerations(browserStorage(), authUser); } catch { setStorageIssue(true); }
    setSyncStatus(navigator.onLine ? 'syncing' : 'offline');
    if (!navigator.onLine) return;
    const offerGuest = () => {
      const guestStorage = accountStorage(browserStorage(), null);
      try { if (guestStorage.getItem('roamly-maps') === null) return null; } catch { setStorageIssue(true); return null; }
      const guest = restoreLocalItinerary(guestStorage, true);
      const question = language === 'es' ? `¿Importar los itinerarios locales de este dispositivo a ${authUser.email}? Hazlo solo si son tuyos.`
        : language === 'en' ? `Import this device's local itineraries into ${authUser.email}? Only do this if they are yours.`
        : `Importar os roteiros locais deste aparelho para ${authUser.email}? Faça isso apenas se forem seus.`;
      return guest.maps.length && window.confirm(question) ? guest : null;
    };
    engine.synchronize(offerGuest).then((result) => {
      if (cancelled || !accountActiveRef.current || engine !== syncEngineRef.current) return;
      cloudLoadedForUserRef.current = owner;
      applySyncResult(result);
      hydratedPlaceKeysRef.current.clear();
    }).catch((error) => {
      if (cancelled || !accountActiveRef.current) return;
      if (error instanceof AccountChangedError) reloadForAccountChange();
      else { setStorageIssue(!engine.durable); setSyncStatus(navigator.onLine ? 'error' : 'offline'); }
    });
    return () => { cancelled = true; };
    // Initialize each account once; queue acknowledgments own later updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, authUser?.generation, cacheOwner, storageReady, syncAttempt, applySyncResult, reloadForAccountChange]);

  useEffect(() => {
    const engine = syncEngineRef.current;
    if (!authUser || !engine || !storageReady || cacheOwner !== accountIdentity(authUser) || cloudLoadedForUserRef.current !== accountIdentity(authUser) || !accountActiveRef.current) return;
    let cancelled = false;
    if (!navigator.onLine) { setSyncStatus('offline'); return; }
    const timer = window.setTimeout(() => {
      if (!accountActiveRef.current) return;
      setSyncStatus('syncing');
      engine.synchronize().then((result) => {
        if (!cancelled && accountActiveRef.current && engine === syncEngineRef.current) applySyncResult(result);
      }).catch((error) => {
        if (cancelled || !accountActiveRef.current) return;
        if (error instanceof AccountChangedError) reloadForAccountChange();
        else { setStorageIssue(!engine.durable); setSyncStatus(navigator.onLine ? 'error' : 'offline'); }
      });
    }, 900);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [authUser, cacheOwner, currentMap, maps, places, storageReady, syncAttempt, applySyncResult, reloadForAccountChange]);

  useEffect(() => {
    if (!authUser) return;
    const retry = () => setSyncAttempt((attempt) => attempt + 1);
    const offline = () => setSyncStatus('offline');
    const visible = () => { if (document.visibilityState === 'visible') retry(); };
    window.addEventListener('online', retry); window.addEventListener('offline', offline); window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', retry); window.removeEventListener('offline', offline); window.removeEventListener('focus', retry);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser || !navigator.onLine || (syncStatus !== 'error' && syncStatus !== 'pending')) return;
    const timer = window.setTimeout(() => setSyncAttempt((attempt) => attempt + 1), 5000);
    return () => window.clearTimeout(timer);
  }, [authUser, syncStatus, syncAttempt]);

  function resolveSync(choice: 'local' | 'cloud') {
    try {
      syncEngineRef.current?.resolve(choice);
      setSyncConflicts([]);
      const next = syncEngineRef.current?.current;
      if (next) applySyncResult({ data: next, conflicts: [], pending: syncEngineRef.current?.pending().length ?? 0, durable: syncEngineRef.current?.durable ?? false });
      setSyncAttempt((attempt) => attempt + 1);
    } catch (error) {
      if (error instanceof ConflictChangedError) {
        setToast(language === 'es' ? 'El conflicto cambió en otra pestaña. Actualizando…' : language === 'en' ? 'The conflict changed in another tab. Refreshing…' : 'O conflito mudou em outra aba. Atualizando…');
        setSyncAttempt((attempt) => attempt + 1);
      } else setStorageIssue(true);
    }
  }

  useEffect(() => {
    if (apiKey === null) return;
    if (!networkOnline) { setMapsStatus('offline'); return; }
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
  }, [apiKey, language, mapsAttempt, networkOnline]);

  useEffect(() => {
    if (mapsStatus !== 'ready' || !storageReady || !currentMap) return;
    let cancelled = false;
    const candidates = places.filter((place) => {
      const key = placeKey(place.placeId, place.destination ?? 'Madri');
      return (place.destination ?? 'Madri') === currentMap && (!hydratedPlaceKeysRef.current.has(key) || !scheduleIsFresh(place.openingSchedule, clock)) && !failedPlaceKeysRef.current.has(key);
    });
    Promise.allSettled(candidates.map(async (savedPlace) => {
      const key = placeKey(savedPlace.placeId, savedPlace.destination ?? 'Madri');
      try {
        const hydrated = await hydratePlaceById(savedPlace, userPosition, language);
        if (cancelled) return;
        return { key, hydrated };
      } catch (error) {
        if (!cancelled) failedPlaceKeysRef.current.add(key);
        throw error;
      }
    })).then((results) => {
      if (cancelled) return;
      const hydrated = new Map<string, Place>();
      for (const result of results) if (result.status === 'fulfilled' && result.value) { hydratedPlaceKeysRef.current.add(result.value.key); hydrated.set(result.value.hydrated.id, result.value.hydrated); }
      if (hydrated.size) setPlaces((current) => dedupePlaces(current.map((item) => hydrated.has(item.id) ? { ...hydrated.get(item.id)!, note: item.note, pinColor: item.pinColor } : item)));
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failure) { const message = formatGoogleError(failure.reason, language); setToast(message); setPlacesError(message); }
    });
    return () => { cancelled = true; };
    // Coalesced provider requests survive cancellation; only a live consumer marks success.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsStatus, storageReady, currentMap, language, placesAttempt, places, clock]);

  function refreshPlaces() {
    hydratedPlaceKeysRef.current.clear();
    failedPlaceKeysRef.current.clear();
    setPlacesError(''); setPlacesAttempt((attempt) => attempt + 1);
  }
  function retryGoogleMaps() { setMapsAttempt((attempt) => attempt + 1); }

  useEffect(() => {
    setNetworkOnline(navigator.onLine);
    const update = () => setClock(Date.now());
    const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    const online = () => {
      setNetworkOnline(true); failedPlaceKeysRef.current.clear(); setPlacesAttempt((attempt) => attempt + 1);
      if (!apiKey) void fetch('/api/google-config').then((r) => r.json() as Promise<{ apiKey?: string }>).then((data) => setApiKey(data.apiKey ?? '')).catch(() => undefined);
      if (!oauthClientId) void fetch('/api/auth/config').then((r) => r.json() as Promise<{ clientId?: string }>).then((data) => setOauthClientId(data.clientId ?? '')).catch(() => undefined);
    };
    const offline = () => setNetworkOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, [apiKey, oauthClientId]);

  const visiblePlaces = useMemo(() => {
    const normalized = searchMode === 'saved' ? query.trim().toLocaleLowerCase(locale) : '';
    return places.map((place) => {
      const schedule = placeAvailability(place, language, clock, networkOnline);
      return { ...place, status: schedule.status, statusLabel: schedule.label, hours: schedule.hours };
    }).filter((place) => {
      const matches = !normalized || `${place.name} ${place.category} ${place.address}`.toLocaleLowerCase(locale).includes(normalized);
      return (place.destination ?? 'Madri') === currentMap && matches && (!onlyOpen || place.status === 'open');
    }).map((place) => userPosition && place.lat != null && place.lng != null
      ? { ...place, distance: formatDistance(haversineMeters(userPosition, { lat: place.lat, lng: place.lng }), language) }
      : { ...place, distance: '—' }).sort((a, b) => {
      const aDistance = sortableDistance(a, userPosition);
      const bDistance = sortableDistance(b, userPosition);
      if (!Number.isFinite(aDistance) && Number.isFinite(bDistance)) return 1;
      if (Number.isFinite(aDistance) && !Number.isFinite(bDistance)) return -1;
      return aDistance !== bDistance ? aDistance - bDistance : a.name.localeCompare(b.name, locale);
    });
  }, [places, query, onlyOpen, currentMap, searchMode, userPosition, locale, language, clock, networkOnline]);

  const todayLabel = useMemo(() => formatDateLabel(new Date(clock), language), [language, clock]);
  const openPlacesCount = visiblePlaces.filter((place) => place.status === 'open').length;
  const soonPlacesCount = visiblePlaces.filter((place) => place.status === 'soon').length;

  useEffect(() => {
    if (detailsDismissed) return;
    if (visiblePlaces.some((place) => place.id === selectedId)) return;
    setSelectedId(visiblePlaces[0]?.id ?? '');
  }, [detailsDismissed, selectedId, visiblePlaces]);

  useEffect(() => {
    if (searchMode !== 'google' || mapsStatus !== 'ready' || query.trim().length < 2) { setPredictions([]); setIsSearchingGoogle(false); return; }
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
  }, [query, searchMode, mapsStatus, liveMap, userPosition, language, locale]);

  useEffect(() => {
    setLocationLabel(userPosition ? t.liveLocation : locationAllowedRef.current ? (language === 'es' ? 'Señal de ubicación no disponible' : language === 'en' ? 'Location signal unavailable' : 'Sinal de localização indisponível') : t.yourLocation);
  }, [userPosition, t.liveLocation, t.yourLocation, language]);

  const selectedBase = visiblePlaces.find((place) => place.id === selectedId) ?? places.find((place) => place.id === selectedId) ?? places[0];
  const selectedAvailability = selectedBase && placeAvailability(selectedBase, language, clock, networkOnline);
  const selected = selectedBase && selectedAvailability ? { ...selectedBase, status: selectedAvailability.status, statusLabel: selectedAvailability.label, hours: selectedAvailability.hours, distance: userPosition ? selectedBase.distance : '—' } : undefined;

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
    if (!selected) return;
    const next = places.map((place) => (place.id === selected.id ? { ...place, note: value } : place));
    setPlaces(next);
    try { localItineraryStorage().setItem('roamly-notes', JSON.stringify(Object.fromEntries(next.map((place) => [place.id, place.note])))); }
    catch { setStorageIssue(true); }
  }

  function savePinColor(pinColor?: string) {
    if (!selected) return;
    setPlaces((current) => current.map((place) => place.id === selected.id ? { ...place, pinColor } : place));
    setToast(pinColor ? (language === 'es' ? 'Color del pin actualizado' : language === 'en' ? 'Pin color updated' : 'Cor do pin atualizada') : (language === 'es' ? 'Color automático restaurado' : language === 'en' ? 'Automatic color restored' : 'Cor automática restaurada'));
  }

  function requestMyLocation() {
    if (isLocating) return;
    if (!navigator.geolocation) { setToast(language === 'es' ? 'Ubicación no disponible en este dispositivo' : language === 'en' ? 'Location is not available on this device' : 'Localização não disponível neste dispositivo'); return; }
    const requestId = ++locationRequestRef.current;
    locationAllowedRef.current = true;
    setLocationAllowed(true);
    setTrackLocation(true);
    setIsLocating(true);
    setLocationLabel(language === 'es' ? 'Localizando…' : language === 'en' ? 'Locating…' : 'Localizando…');
    navigator.geolocation.getCurrentPosition(
      (position) => { if (requestId !== locationRequestRef.current || !locationAllowedRef.current) return; if (!freshLocation(position)) { loseLocation(); setIsLocating(false); return; } const next = { lat: position.coords.latitude, lng: position.coords.longitude }; updateUserPosition(next, position.timestamp); liveMap?.panTo(next); liveMap?.setZoom(16); setLocationLabel(t.liveLocation); setIsLocating(false); setToast(language === 'es' ? 'Mapa centrado en tu ubicación' : language === 'en' ? 'Map centered on your location' : 'Mapa centralizado na sua localização'); },
      () => { if (requestId !== locationRequestRef.current) return; loseLocation(); setTrackLocation(false); setLocationLabel(language === 'es' ? 'Ubicación no disponible' : language === 'en' ? 'Location unavailable' : 'Localização indisponível'); setIsLocating(false); setToast(language === 'es' ? 'Permite el acceso a la ubicación para centrar el mapa' : language === 'en' ? 'Allow location access to center the map' : 'Permita o acesso à localização para centralizar o mapa'); },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  function useMyLocation() {
    if (isLocating) return;
    if (!locationAllowedRef.current) { setLocationPromptOpen(true); return; }
    requestMyLocation();
  }

  function stopLocationTracking() {
    locationAllowedRef.current = false;
    setLocationAllowed(false);
    locationRequestRef.current += 1;
    setTrackLocation(false);
    setUserPosition(null);
    setIsLocating(false);
    setLocationLabel(t.yourLocation);
  }

  function openRouteOptions() {
    if (!selected) return;
    setRoutePlace(selected);
    setRouteOpen(true);
  }

  function openRemoveConfirmation() { if (selected) { setRemoveTarget(selected); setRemoveConfirmOpen(true); } }
  useEffect(() => {
    if (routeOpen && routePlace && !places.some((place) => place.id === routePlace.id)) setRouteOpen(false);
    if (removeConfirmOpen && removeTarget && !places.some((place) => place.id === removeTarget.id)) setRemoveConfirmOpen(false);
  }, [places, routeOpen, routePlace, removeConfirmOpen, removeTarget]);

  function openDirections(mode: TravelMode) {
    const target = routePlace && places.find((place) => place.id === routePlace.id);
    if (!target) { setRouteOpen(false); return; }
    const url = getDirectionsUrl(target, mode);
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
        const removed = JSON.parse(localItineraryStorage().getItem(removedPlacesStorageKey) ?? '[]') as string[];
        localItineraryStorage().setItem(removedPlacesStorageKey, JSON.stringify(removed.filter((removedKey) => removedKey !== key)));
      } catch { setStorageIssue(true); }
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
      const removed = JSON.parse(localItineraryStorage().getItem(removedPlacesStorageKey) ?? '[]') as string[];
      localItineraryStorage().setItem(removedPlacesStorageKey, JSON.stringify(removed.filter((removedKey) => removedKey !== key)));
    } catch { setStorageIssue(true); }
    showPlace(mapPlaceCandidate.id);
    setMapPlaceCandidate(null);
    addingPlaceKeysRef.current.delete(key);
    setToast(language === 'es' ? `${mapPlaceCandidate.name} añadido al itinerario` : language === 'en' ? `${mapPlaceCandidate.name} added to the itinerary` : `${mapPlaceCandidate.name} adicionado ao roteiro`);
  }

  function removeSelectedPlace() {
    const target = removeTarget && places.find((place) => place.id === removeTarget.id);
    if (!target) { setRemoveConfirmOpen(false); return; }
    const key = placeKey(target.placeId, target.destination ?? 'Madri');
    const remaining = places.filter((place) => placeKey(place.placeId, place.destination ?? 'Madri') !== key);
    setPlaces(remaining);
    try {
      const removed = JSON.parse(localItineraryStorage().getItem(removedPlacesStorageKey) ?? '[]') as string[];
      localItineraryStorage().setItem(removedPlacesStorageKey, JSON.stringify(Array.from(new Set([...removed, key]))));
      const notes = JSON.parse(localItineraryStorage().getItem('roamly-notes') ?? '{}') as Record<string, string>;
      delete notes[target.id];
      localItineraryStorage().setItem('roamly-notes', JSON.stringify(notes));
    } catch { setStorageIssue(true); }
    const nextSelected = remaining.find((place) => (place.destination ?? 'Madri') === currentMap);
    setSelectedId(nextSelected?.id ?? '');
    setDetailsDismissed(false);
    setRemoveConfirmOpen(false);
    setRouteOpen(false);
    setToast(language === 'es' ? `${target.name} eliminado del itinerario` : language === 'en' ? `${target.name} removed from the itinerary` : `${target.name} removido do roteiro`);
  }

  function deleteMap() {
    if (!mapPendingDelete) return;
    const remainingMaps = maps.filter((mapName) => mapName !== mapPendingDelete);
    const deletedPlaces = places.filter((place) => (place.destination ?? 'Madri') === mapPendingDelete);
    const remainingPlaces = places.filter((place) => (place.destination ?? 'Madri') !== mapPendingDelete);
    try {
      const removed = JSON.parse(localItineraryStorage().getItem(removedPlacesStorageKey) ?? '[]') as string[];
      const deletedKeys = deletedPlaces.map((place) => placeKey(place.placeId, place.destination ?? 'Madri'));
      localItineraryStorage().setItem(removedPlacesStorageKey, JSON.stringify(Array.from(new Set([...removed, ...deletedKeys]))));
      const notes = JSON.parse(localItineraryStorage().getItem('roamly-notes') ?? '{}') as Record<string, string>;
      deletedPlaces.forEach((place) => delete notes[place.id]);
      localItineraryStorage().setItem('roamly-notes', JSON.stringify(notes));
    } catch { setStorageIssue(true); }
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
    try { browserStorage().setItem('roamly-google-maps-key', cleanKey); } catch { setStorageIssue(true); }
    setApiKey(cleanKey);
    setMapsAttempt((attempt) => attempt + 1);
  }

  async function logout() {
    if (!authUser || !accountActiveRef.current) return;
    const transition = ++accountTransitionRef.current;
    const previousCloudOwner = cloudLoadedForUserRef.current;
    accountActiveRef.current = false;
    cloudLoadedForUserRef.current = '';
    setAuthLoading(true);
    try {
      const token = await authChallenge();
      const response = await accountFetch(accountIdentity(authUser), '/api/auth/logout', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Roamly-CSRF': token }, body: '{}',
      });
      if (!response.ok) throw new Error('Não foi possível sair. Tente novamente.');
      announceAccountChange();
      reloadForAccountChange();
    } catch (error) {
      if (transition !== accountTransitionRef.current) return;
      if (error instanceof AccountChangedError) { reloadForAccountChange(); return; }
      accountActiveRef.current = true;
      cloudLoadedForUserRef.current = previousCloudOwner;
      if (previousCloudOwner !== accountIdentity(authUser)) setSyncAttempt((attempt) => attempt + 1);
      setAuthError(error instanceof Error ? error.message : 'Não foi possível sair');
      setAuthLoading(false);
    }
  }

  async function exportMyData() {
    const identity = authUser ? accountIdentity(authUser) : null;
    let cloudCopy: unknown = null;
    let sharedInvites: unknown[] = [];
    let cloudUnavailable = false;
    if (identity) {
      try {
      const response = await accountFetch(identity, '/api/sync');
      if (!response.ok) throw new Error('Export failed');
      const payload = await response.json() as { userId?: string; data?: { maps: string[]; currentMap: string; places: Place[] } | null };
      if (payload.userId !== identity) throw new AccountChangedError('The account changed');
      cloudCopy = payload.data ? { ...payload.data, places: payload.data.places.map(withoutDistance) } : null;
      const inviteResponse = await accountFetch(identity, '/api/shares');
      if (!inviteResponse.ok) throw new Error('Could not export invitations');
      const invites = await inviteResponse.json() as { shares?: unknown[] };
      sharedInvites = invites.shares ?? [];
      } catch (error) {
        if (error instanceof AccountChangedError) throw error;
        cloudUnavailable = true; // An offline export must still rescue this device's edits.
      }
      if (!accountActiveRef.current) throw new AccountChangedError('The account changed');
    }
    const content = {
      app: 'Easy Road Map', version: 1, exportedAt: new Date().toISOString(),
      account: authUser ? { provider: 'Google', id: authUser.id, name: authUser.name, email: authUser.email } : null,
      preferences: { theme, language },
      localItinerary: { maps, currentMap, places: places.map(withoutDistance) },
      ...(identity ? { pendingEdits: syncEngineRef.current?.pending() ?? [], cloudUnavailable } : {}),
      ...(identity ? { cloudItinerary: cloudCopy } : {}),
      ...(identity ? { sharedMapInvitations: sharedInvites } : {}),
    };
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `easy-road-map-dados-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function deleteMyData() {
    if (!authUser) {
      try { clearItineraryCache(browserStorage(), null); } catch { setStorageIssue(true); throw new Error(privacyCopy[language].failure); }
      setMaps([]); setCurrentMap(''); setPlaces([]); setSelectedId('');
      setPrivacyOpen(false); setAuthOpen(false); setToast(privacyCopy[language].deleted);
      return;
    }
    const identity = accountIdentity(authUser);
    const previousCloudOwner = cloudLoadedForUserRef.current;
    accountActiveRef.current = false;
    cloudLoadedForUserRef.current = '';
    let deletedRemotely = false;
    try {
      const challenge = await authChallenge();
      const response = await accountFetch(identity, '/api/sync', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Roamly-CSRF': challenge }, body: '{}',
      });
      if (!response.ok) throw new Error('Deletion failed');
      deletedRemotely = true;
      try { clearItineraryCache(browserStorage(), authUser.id); } catch { setStorageIssue(true); }
      stopLocationTracking();
      announceAccountChange(authUser.id);
      reloadForAccountChange();
    } catch (error) {
      if (!deletedRemotely && !(error instanceof AccountChangedError)) {
        accountActiveRef.current = true;
        cloudLoadedForUserRef.current = previousCloudOwner;
      }
      throw error;
    }
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return {
    theme,
    themeReady,
    language,
    t,
    locale,
    places,
    selectedId,
    detailsDismissed,
    view,
    setView,
    query,
    setQuery,
    searchMode,
    setSearchMode,
    placesError,
    refreshPlaces,
    retryGoogleMaps,
    filterOpen,
    setFilterOpen,
    onlyOpen,
    setOnlyOpen,
    routeOpen,
    routePlace,
    removeTarget,
    openRemoveConfirmation,
    setRouteOpen,
    removeConfirmOpen,
    setRemoveConfirmOpen,
    mapPendingDelete,
    setMapPendingDelete,
    mapsOpen,
    setMapsOpen,
    shareMapName,
    setShareMapName,
    newMapName,
    setNewMapName,
    maps,
    currentMap,
    locationLabel,
    toast,
    setToast,
    zoom,
    setZoom,
    storageReady,
    isLocating,
    mapsStatus,
    mapsError,
    predictions,
    isSearchingGoogle,
    liveMap,
    setLiveMap,
    userPosition,
    trackLocation,
    mapPlaceCandidate,
    setMapPlaceCandidate,
    mapPlaceLoading,
    authOpen,
    setAuthOpen,
    privacyOpen,
    setPrivacyOpen,
    locationPromptOpen,
    setLocationPromptOpen,
    authUser,
    authLoading,
    authError,
    oauthClientId,
    syncStatus,
    syncConflicts,
    storageIssue,
    resolveSync,
    setSyncAttempt,
    locationAllowed,
    googleButtonRef,
    searchInputRef,
    toggleTheme,
    updateUserPosition,
    changeLanguage,
    visiblePlaces,
    todayLabel,
    openPlacesCount,
    soonPlacesCount,
    selected,
    showPlace,
    closePlaceDetails,
    saveNote,
    savePinColor,
    requestMyLocation,
    useMyLocation,
    stopLocationTracking,
    openRouteOptions,
    openDirections,
    createMap,
    openMap,
    selectGooglePrediction,
    selectPlaceFromMap,
    addMapPlaceCandidate,
    removeSelectedPlace,
    deleteMap,
    connectGoogleMaps,
    logout,
    exportMyData,
    deleteMyData
  };
}
