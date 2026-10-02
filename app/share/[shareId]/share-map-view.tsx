'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowUpRight, BookmarkPlus, Clock3, Compass, MapPin, Moon, Sun } from 'lucide-react';
import { accountFetch, authChallenge } from '../../account-storage';
import { languageLocales } from '../../i18n';
import { createMarkerRegistry } from '../../map-markers';
import { parsePlace } from '../../place-schema';
import type { Place } from '../../trip-guide/types';
import { loadGoogleMaps, loadGoogleIdentity } from '../../trip-guide/google-runtime';
import { hydratePlaceById, calculateSchedule, localizedCategory, localizedStatusLabel, localizedHours, formatGoogleError } from '../../trip-guide/google-places';
import { PlacePhoto, PhotoCredits } from '../../trip-guide/place-components';
import { uxCopy } from '../../trip-guide/ux-copy';
import { useBrowserEnvironment, setBrowserLanguage, setBrowserTheme } from '../../trip-guide/use-browser-environment';

type AuthUser = { id: string; email: string; name: string; generation: string };
type SharedPlace = Place;
type SharedMap = { name: string; places: SharedPlace[] };
type SharedMapResult = { map: SharedMap | null; error: 'login' | 'not-available' | 'failed' | ''; invalidCount?: number };
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> };


const text = {
  pt: { label: 'ROTEIRO COMPARTILHADO', loading: 'Verificando este convite…', signIn: 'Entre para ver o mapa', signInHelp: 'Use exatamente a Conta Google que recebeu o convite.', noInvitation: 'Este convite não está disponível para esta conta. Confirme o e-mail convidado ou peça um novo link.', error: 'Não foi possível carregar o mapa. Verifique a conexão e tente novamente.', places: 'lugares neste roteiro', noPlaces: 'Este mapa ainda não tem locais salvos.', address: 'Endereço não informado', hours: 'Horários não informados', viewPlace: 'Ver no Google Maps', private: 'Somente pessoas convidadas por e-mail podem ver este roteiro. Notas pessoais não são compartilhadas.', switchAccount: 'Sair para trocar de conta', brand: 'Seu roteiro, compartilhado com segurança', statusOpen: 'Aberto agora', statusSoon: 'Fecha em breve', statusClosed: 'Fechado ou horário indisponível', map: 'Mapa', save: 'Salvar em Meus roteiros', saving: 'Salvando roteiro…', saveError: 'Não foi possível salvar. Tente novamente.', installTitle: 'Abra este convite como app', installIos: 'No Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”. Depois, abra o Easy Road Map pelo ícone.', installAndroid: 'No Chrome, escolha “Instalar app” no menu para abrir convites dentro do Easy Road Map.', install: 'Instalar app' },
  es: { label: 'ITINERARIO COMPARTIDO', loading: 'Verificando esta invitación…', signIn: 'Inicia sesión para ver el mapa', signInHelp: 'Usa exactamente la Cuenta de Google que recibió la invitación.', noInvitation: 'Esta invitación no está disponible para esta cuenta. Comprueba el correo invitado o solicita un nuevo enlace.', error: 'No se pudo cargar el mapa. Comprueba tu conexión e inténtalo de nuevo.', places: 'lugares en este itinerario', noPlaces: 'Este mapa todavía no tiene lugares guardados.', address: 'Dirección no indicada', hours: 'Horario no indicado', viewPlace: 'Ver en Google Maps', private: 'Solo las personas invitadas por correo pueden ver este itinerario. No se comparten notas personales.', switchAccount: 'Cerrar sesión para cambiar de cuenta', brand: 'Tu itinerario, compartido de forma segura', statusOpen: 'Abierto ahora', statusSoon: 'Cierra pronto', statusClosed: 'Cerrado u horario no disponible', map: 'Mapa', save: 'Guardar en Mis itinerarios', saving: 'Guardando itinerario…', saveError: 'No se pudo guardar. Inténtalo de nuevo.', installTitle: 'Abre esta invitación como app', installIos: 'En Safari, toca Compartir y elige “Añadir a pantalla de inicio”. Después, abre Easy Road Map desde su icono.', installAndroid: 'En Chrome, elige “Instalar app” en el menú para abrir invitaciones dentro de Easy Road Map.', install: 'Instalar app' },
  en: { label: 'SHARED ITINERARY', loading: 'Checking this invitation…', signIn: 'Sign in to view this map', signInHelp: 'Use the exact Google Account that received the invitation.', noInvitation: 'This invitation is unavailable for this account. Check the invited email or request a new link.', error: 'Could not load the map. Check your connection and try again.', places: 'places in this itinerary', noPlaces: 'This map has no saved places yet.', address: 'Address not provided', hours: 'Hours not provided', viewPlace: 'View on Google Maps', private: 'Only people invited by email can view this itinerary. Personal notes are not shared.', switchAccount: 'Sign out to switch accounts', brand: 'Your itinerary, shared securely', statusOpen: 'Open now', statusSoon: 'Closing soon', statusClosed: 'Closed or hours unavailable', map: 'Map', save: 'Save to My itineraries', saving: 'Saving itinerary…', saveError: 'Could not save. Please try again.', installTitle: 'Open this invite like an app', installIos: 'In Safari, tap Share and choose “Add to Home Screen”. Then open Easy Road Map from its icon.', installAndroid: 'In Chrome, choose “Install app” from the menu to open invites inside Easy Road Map.', install: 'Install app' },
};


export function SharedMapView({ shareId }: { shareId: string }) {
  const { language, dark, showInstallHelp, isIos } = useBrowserEnvironment();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [clientId, setClientId] = useState('');
  const [map, setMap] = useState<SharedMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'login' | 'not-available' | 'failed' | ''>('');
  const [loginError, setLoginError] = useState('');
  const [mapsKey, setMapsKey] = useState('');
  const [mapError, setMapError] = useState(false);
  const [invalidCount, setInvalidCount] = useState(0);
  const [livePlaces, setLivePlaces] = useState<Record<string, Place>>({});
  const [placesError, setPlacesError] = useState('');
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [selectedPlaceId, setSelectedPlaceId] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const googleButton = useRef<HTMLDivElement>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markerRegistryRef = useRef<ReturnType<typeof createMarkerRegistry> | null>(null);
  const copy = text[language];

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/config', { cache: 'no-store' }).then((response) => response.json() as Promise<{ clientId?: string }>).catch((): { clientId?: string } => ({})),
      fetch('/api/auth/session', { cache: 'no-store' }).then((response) => response.json() as Promise<{ user?: AuthUser | null }>).catch(() => ({ user: null })),
      fetch('/api/google-config', { cache: 'no-store' }).then((response) => response.json() as Promise<{ apiKey?: string }>).catch((): { apiKey?: string } => ({})),
    ]).then(([config, session, mapsConfig]) => { setClientId(config.clientId ?? ''); setUser(session.user ?? null); setMapsKey(mapsConfig.apiKey ?? ''); setLoading(false); });
  }, []);

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
  }, []);

  const loadSharedMap = useCallback(async (): Promise<SharedMapResult> => {
    try {
      const response = await fetch(`/api/shares?shareId=${encodeURIComponent(shareId)}`, { cache: 'no-store' });
      if (response.status === 401) return { error: 'login', map: null };
      if (response.status === 404) return { error: 'not-available', map: null };
      if (!response.ok) throw new Error('Request failed');
      const payload = await response.json() as { map?: { name?: unknown; places?: unknown[] }; invalidCount?: number };
      if (!payload.map || typeof payload.map.name !== 'string' || !payload.map.name.trim() || payload.map.name.length > 120 || !Array.isArray(payload.map.places)) throw new Error('Invalid response');
      const parsed = payload.map.places.map((place) => parsePlace(place, { strict: true }));
      return { error: '', map: { name: payload.map.name, places: parsed.flatMap((item) => item.place ? [item.place] : []) }, invalidCount: parsed.filter((item) => !item.place).length + (Number.isSafeInteger(payload.invalidCount) && payload.invalidCount! > 0 ? payload.invalidCount! : 0) };
    } catch { return { error: 'failed', map: null }; }
  }, [shareId]);

  const applySharedMap = useCallback((result: SharedMapResult) => {
    setError(result.error); setMap(result.map); setInvalidCount(result.invalidCount ?? 0); setLivePlaces({});
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!loading && user) void loadSharedMap().then((result) => { if (!cancelled) applySharedMap(result); });
    return () => { cancelled = true; };
  }, [loading, user, loadSharedMap, applySharedMap]);

  function reloadSharedMap() {
    setError(''); setMap(null);
    void loadSharedMap().then(applySharedMap);
  }

  const displayPlaces = useMemo(() => (map?.places ?? []).map((place) => {
    const live = Object.hasOwn(livePlaces, place.id) ? { ...livePlaces[place.id], pinColor: place.pinColor } : place;
    if (!live.openingSchedule) return live;
    const schedule = calculateSchedule(live.openingSchedule, language, clock);
    return { ...live, status: schedule.status, statusLabel: schedule.label, hours: schedule.hours };
  }), [map, livePlaces, language, clock]);
  const hasLocatedPlace = displayPlaces.some((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
  const currentMapSetup = useEffectEvent(() => ({ language, dark, selectedPlaceId, places: displayPlaces }));

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!map || !mapsKey) return;
    let cancelled = false;
    void loadGoogleMaps(mapsKey, language).then(async () => {
      const results = await Promise.allSettled(map.places.map((place) => hydratePlaceById(place, null, language)));
      if (cancelled) return;
      setLivePlaces(Object.fromEntries(results.flatMap((result) => result.status === 'fulfilled' ? [[result.value.id, result.value]] : [])));
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      setPlacesError(failure ? formatGoogleError(failure.reason, language) : '');
    }).catch((error) => { if (!cancelled) setPlacesError(formatGoogleError(error, language)); });
    return () => { cancelled = true; };
  }, [map, mapsKey, language, refreshAttempt]);

  useEffect(() => {
    const container = mapContainer.current;
    if (!container || !mapsKey || !hasLocatedPlace) return;
    let cancelled = false;
    const { language, dark, selectedPlaceId, places } = currentMapSetup();
    loadGoogleMaps(mapsKey, language).then(() => {
      if (cancelled || !mapContainer.current) return;
      const located = places.filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
      if (!located.length) return;
      const center = { lat: located[0].lat!, lng: located[0].lng! };
      const googleMap = new google.maps.Map(mapContainer.current, { center, zoom: 13, mapId: 'DEMO_MAP_ID', gestureHandling: 'greedy', mapTypeControl: false, streetViewControl: false, fullscreenControl: false, colorScheme: dark ? 'DARK' : 'LIGHT' });
      const registry = createMarkerRegistry(googleMap, setSelectedPlaceId);
      registry.update(located.map((place, index) => ({ id: place.id, lat: place.lat!, lng: place.lng!, title: place.name, color: place.pinColor || (place.status === 'open' ? '#1f7a50' : place.status === 'soon' ? '#e1a43a' : '#9a7068'), glyph: String(index + 1), selected: place.id === selectedPlaceId })));
      googleMapRef.current = googleMap; markerRegistryRef.current = registry;
      if (located.length > 1) {
        const bounds = new google.maps.LatLngBounds();
        located.forEach((place) => bounds.extend({ lat: place.lat!, lng: place.lng! }));
        googleMap.fitBounds(bounds, 54);
      }
    }).catch(() => { if (!cancelled) setMapError(true); });
    return () => {
      cancelled = true;
      markerRegistryRef.current?.clear(); markerRegistryRef.current = null;
      if (googleMapRef.current) google.maps.event.clearInstanceListeners(googleMapRef.current);
      googleMapRef.current = null;
      container.replaceChildren();
    };
  }, [mapsKey, map, hasLocatedPlace, refreshAttempt]);

  useEffect(() => { googleMapRef.current?.setOptions({ colorScheme: dark ? 'DARK' : 'LIGHT' }); }, [dark]);

  useEffect(() => {
    const located = displayPlaces.filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
    markerRegistryRef.current?.update(located.map((place, index) => ({ id: place.id, lat: place.lat!, lng: place.lng!, title: place.name, color: place.pinColor || (place.status === 'open' ? '#1f7a50' : place.status === 'soon' ? '#e1a43a' : '#9a7068'), glyph: String(index + 1), selected: place.id === selectedPlaceId })));
  }, [displayPlaces, selectedPlaceId]);

  const onCredential = useCallback(async (response: { credential?: string }) => {
    if (!response.credential) { setLoginError(copy.error); return; }
    setLoginBusy(true); setLoginError('');
    try {
      const csrf = await authChallenge();
      const result = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Roamly-CSRF': csrf }, body: JSON.stringify({ credential: response.credential }) });
      const payload = await result.json() as { user?: { id: string }; error?: string };
      if (!result.ok || !payload.user) throw new Error(payload.error || copy.error);
      const sessionResponse = await fetch('/api/auth/session', { cache: 'no-store' });
      const session = await sessionResponse.json() as { user?: AuthUser | null };
      if (!sessionResponse.ok || !session.user?.generation) throw new Error(copy.error);
      setUser(session.user);
    } catch (cause) { setLoginError(cause instanceof Error ? cause.message : copy.error); }
    finally { setLoginBusy(false); }
  }, [copy.error]);

  useEffect(() => {
    if (loading || user || !clientId || !googleButton.current) return;
    let cancelled = false;
    loadGoogleIdentity().then((identity) => {
      if (cancelled || !googleButton.current) return;
      identity.initialize({ client_id: clientId, callback: onCredential, auto_select: false });
      googleButton.current.replaceChildren();
      identity.renderButton(googleButton.current, { type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: languageLocales[language], width: 300 });
    }).catch(() => { if (!cancelled) setLoginError(copy.error); });
    return () => { cancelled = true; };
  }, [loading, user, clientId, onCredential, dark, language, copy.error]);

  function changeLanguage(value: string) {
    setBrowserLanguage(value);
  }

  function toggleTheme() {
    setBrowserTheme(!dark);
  }

  async function switchAccount() {
    if (!user) return;
    setLoginBusy(true);
    try {
      const csrf = await authChallenge();
      const identity = `${user.id}:${user.generation}`;
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Roamly-CSRF': csrf, 'X-Roamly-Account': identity }, body: '{}' });
      if (!response.ok) throw new Error(copy.error);
      setUser(null); setMap(null); setError(''); setLoginError('');
    } catch (cause) { setLoginError(cause instanceof Error ? cause.message : copy.error); }
    finally { setLoginBusy(false); }
  }

  async function saveToMyItineraries() {
    if (!user || saveBusy) return;
    setSaveBusy(true); setSaveError('');
    try {
      const csrf = await authChallenge();
      const identity = `${user.id}:${user.generation}`;
      const response = await accountFetch(identity, '/api/shares/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Roamly-CSRF': csrf },
        body: JSON.stringify({ shareId }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || copy.saveError);
      window.location.assign('/');
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : copy.saveError);
      setSaveBusy(false);
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function placeMapUrl(place: SharedPlace) {
    const params = new URLSearchParams({ api: '1', query: place.name + (place.address ? `, ${place.address}` : '') });
    if (place.placeId) params.set('query_place_id', place.placeId);
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  return <main className="shared-map-page">
    <header className="shared-map-header">
      <Link className="shared-brand" href="/"><span><Compass size={21} /></span><strong>Easy Road Map</strong></Link>
      <div className="shared-tools"><label className="language-picker" aria-label={language === 'en' ? 'Language' : language === 'es' ? 'Idioma' : 'Idioma'}><span>{language.toUpperCase()}</span><select value={language} onChange={(event) => changeLanguage(event.target.value)}><option value="pt">Português</option><option value="es">Español</option><option value="en">English</option></select></label><button className="theme-toggle" onClick={toggleTheme} aria-label={dark ? 'Light mode' : 'Dark mode'}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button></div>
    </header>
    <section className="shared-map-main">
      {!loading && showInstallHelp && <aside className="shared-install-tip"><div><strong>{copy.installTitle}</strong><p>{isIos ? copy.installIos : copy.installAndroid}</p></div>{installPrompt && <button type="button" onClick={() => void installApp()}>{copy.install}</button>}</aside>}
      {loading ? <div className="share-state"><span className="search-spinner" /><p>{copy.loading}</p></div> : !user ? <section className="share-signin-card">
        <span className="share-hero-icon"><MapPin size={28} /></span><span className="share-eyebrow">{copy.label}</span><h1>{copy.signIn}</h1><p>{copy.signInHelp}</p>
        <div ref={googleButton} className="google-login-button" />
        {!clientId && <p className="auth-error">Google sign-in is unavailable right now.</p>}
        {loginBusy && <p className="share-muted">{copy.loading}</p>}{loginError && <p role="alert" className="auth-error">{loginError}</p>}
      </section> : error === 'login' ? <div className="share-state"><p>{copy.error}</p><button onClick={() => reloadSharedMap()}>↻</button></div> : error === 'not-available' ? <section className="share-signin-card"><span className="share-hero-icon"><MapPin size={28} /></span><h1>{copy.signIn}</h1><p>{copy.noInvitation}</p><strong className="share-user-email">{user.email}</strong><button className="share-switch-account" disabled={loginBusy} onClick={() => void switchAccount()}>{copy.switchAccount}</button>{loginError && <p role="alert" className="auth-error">{loginError}</p>}</section> : error === 'failed' ? <div className="share-state"><p>{copy.error}</p><button onClick={() => reloadSharedMap()}>{language === 'pt' ? 'Tentar novamente' : language === 'es' ? 'Reintentar' : 'Try again'}</button></div> : !map ? <div className="share-state"><span className="search-spinner" /><p>{copy.loading}</p></div> : <>
        <div className="shared-map-title"><span className="share-eyebrow">{copy.label}</span><h1>{map.name}</h1><p>{map.places.length} {copy.places}</p><button className="save-shared-map" onClick={() => void saveToMyItineraries()} disabled={saveBusy}><BookmarkPlus size={18} />{saveBusy ? copy.saving : copy.save}</button>{saveError && <p className="share-save-error" role="alert">{saveError}</p>}</div>
        <p className="shared-privacy-note">{copy.private}</p>
        {invalidCount > 0 && <p className="share-save-error" role="alert">{uxCopy[language].invalid}</p>}
        {placesError && <p className="share-map-unavailable" role="status">{placesError} <button onClick={() => { setPlacesError(''); setMapError(false); setRefreshAttempt((attempt) => attempt + 1); }}>{uxCopy[language].retry}</button></p>}
        {map.places.length === 0 ? <div className="share-empty-map"><MapPin size={24} /><p>{copy.noPlaces}</p></div> : <div className="shared-place-list">{displayPlaces.map((place, index) => <article className={`shared-place-card ${selectedPlaceId === place.id ? 'selected' : ''}`} key={place.id} onClick={() => { setSelectedPlaceId(place.id); if (place.lat != null && place.lng != null) { googleMapRef.current?.panTo({ lat: place.lat, lng: place.lng }); googleMapRef.current?.setZoom(15); } }}>
          <div className="shared-place-photo"><MapPin size={24} /><PlacePhoto place={place} language={language} lazy /><span className="shared-place-index">{String(index + 1).padStart(2, '0')}</span></div><PhotoCredits place={place} language={language} className="shared-photo-credit" />
          <div className="shared-place-copy"><div className="shared-place-kicker">{localizedCategory(place.category, language) || copy.map}{place.rating ? ` · ★ ${place.rating}` : ''}</div><h2>{place.name}</h2><p>{place.address || copy.address}</p><div className="shared-place-hours"><Clock3 size={15} /><span>{localizedStatusLabel(place.statusLabel, language)} · {localizedHours(place.hours, language) || copy.hours}</span></div><a href={placeMapUrl(place)} target="_blank" rel="noreferrer">{copy.viewPlace}<ArrowUpRight size={15} /></a></div>
        </article>)}</div>}
      {hasLocatedPlace && <section className="shared-map-canvas-wrap"><div className="share-map-canvas-heading"><strong>{copy.map}</strong><span>{map.places.length} {copy.places}</span></div><div ref={mapContainer} className="shared-google-map" aria-label={copy.map} />{!mapsKey && <p className="share-map-unavailable">{language === 'pt' ? 'O mapa interativo não está disponível agora. Os locais e as rotas continuam acessíveis abaixo.' : language === 'es' ? 'El mapa interactivo no está disponible ahora. Los lugares y las rutas siguen disponibles abaixo.' : 'The interactive map is unavailable right now. Places and directions are still available below.'}</p>}{mapError && <p className="share-map-unavailable">{copy.error}</p>}</section>}
      <footer className="shared-map-footer"><p>{copy.private}</p><Link href="/">Easy Road Map <Compass size={14} /></Link></footer>
      </>}
    </section>
  </main>;
}
