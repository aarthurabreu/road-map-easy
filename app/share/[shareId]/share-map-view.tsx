'use client';

/* Google Places photos are signed URLs supplied by the official Places API. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookmarkPlus, Clock3, Compass, MapPin, Moon, Sun } from 'lucide-react';
import { accountFetch, authChallenge } from '../../account-storage';
import { languageLocales, normalizeLanguage, type Language } from '../../i18n';
import { createMarkerRegistry } from '../../map-markers';

type AuthUser = { id: string; email: string; name: string; generation: string };
type SharedPlace = { id: string; placeId: string; name: string; category?: string; address?: string; hours?: string; status?: string; statusLabel?: string; photo?: string; rating?: string; lat?: number; lng?: number; googleMapsURI?: string; pinColor?: string };
type SharedMap = { name: string; places: SharedPlace[] };
type IdentityApi = { initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void; auto_select?: boolean }) => void; renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void };

function loadGoogleMapsForShare(apiKey: string, language: Language) {
  const runtimeWindow = window as Window & { google?: typeof google; __shareMapsReady?: () => void };
  if (runtimeWindow.google?.maps?.Map && runtimeWindow.google.maps.marker?.AdvancedMarkerElement) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = document.querySelector<HTMLScriptElement>('script[data-roamly-google-maps]') ?? document.createElement('script');
    let timeout = 0;
    const finish = () => {
      if (runtimeWindow.google?.maps?.Map && runtimeWindow.google.maps.marker?.AdvancedMarkerElement) { window.clearTimeout(timeout); resolve(); }
      else reject(new Error('Google Maps unavailable'));
    };
    if (script.dataset.roamlyGoogleMaps === 'true') {
      const interval = window.setInterval(() => { if (runtimeWindow.google?.maps?.Map) { window.clearInterval(interval); finish(); } }, 100);
      timeout = window.setTimeout(() => { window.clearInterval(interval); reject(new Error('Google Maps timeout')); }, 15_000);
      return;
    }
    script.dataset.roamlyGoogleMaps = 'true'; script.async = true;
    runtimeWindow.__shareMapsReady = finish;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&language=${encodeURIComponent(languageLocales[language])}&libraries=places,marker&callback=__shareMapsReady`;
    script.onerror = () => reject(new Error('Google Maps unavailable'));
    document.head.appendChild(script);
  });
}

const text = {
  pt: { label: 'ROTEIRO COMPARTILHADO', loading: 'Verificando este convite…', signIn: 'Entre para ver o mapa', signInHelp: 'Use exatamente a Conta Google que recebeu o convite.', noInvitation: 'Este convite não está disponível para esta conta. Confirme o e-mail convidado ou peça um novo link.', error: 'Não foi possível carregar o mapa. Verifique a conexão e tente novamente.', places: 'lugares neste roteiro', noPlaces: 'Este mapa ainda não tem locais salvos.', address: 'Endereço não informado', hours: 'Horários não informados', viewPlace: 'Ver no Google Maps', private: 'Somente pessoas convidadas por e-mail podem ver este roteiro. Notas pessoais não são compartilhadas.', switchAccount: 'Sair para trocar de conta', brand: 'Seu roteiro, compartilhado com segurança', statusOpen: 'Aberto agora', statusSoon: 'Fecha em breve', statusClosed: 'Fechado ou horário indisponível', map: 'Mapa', save: 'Salvar em Meus roteiros', saving: 'Salvando roteiro…', saveError: 'Não foi possível salvar. Tente novamente.' },
  es: { label: 'ITINERARIO COMPARTIDO', loading: 'Verificando esta invitación…', signIn: 'Inicia sesión para ver el mapa', signInHelp: 'Usa exactamente la Cuenta de Google que recibió la invitación.', noInvitation: 'Esta invitación no está disponible para esta cuenta. Comprueba el correo invitado o solicita un nuevo enlace.', error: 'No se pudo cargar el mapa. Comprueba tu conexión e inténtalo de nuevo.', places: 'lugares en este itinerario', noPlaces: 'Este mapa todavía no tiene lugares guardados.', address: 'Dirección no indicada', hours: 'Horario no indicado', viewPlace: 'Ver en Google Maps', private: 'Solo las personas invitadas por correo pueden ver este itinerario. No se comparten notas personales.', switchAccount: 'Cerrar sesión para cambiar de cuenta', brand: 'Tu itinerario, compartido de forma segura', statusOpen: 'Abierto ahora', statusSoon: 'Cierra pronto', statusClosed: 'Cerrado u horario no disponible', map: 'Mapa', save: 'Guardar en Mis itinerarios', saving: 'Guardando itinerario…', saveError: 'No se pudo guardar. Inténtalo de nuevo.' },
  en: { label: 'SHARED ITINERARY', loading: 'Checking this invitation…', signIn: 'Sign in to view this map', signInHelp: 'Use the exact Google Account that received the invitation.', noInvitation: 'This invitation is unavailable for this account. Check the invited email or request a new link.', error: 'Could not load the map. Check your connection and try again.', places: 'places in this itinerary', noPlaces: 'This map has no saved places yet.', address: 'Address not provided', hours: 'Hours not provided', viewPlace: 'View on Google Maps', private: 'Only people invited by email can view this itinerary. Personal notes are not shared.', switchAccount: 'Sign out to switch accounts', brand: 'Your itinerary, shared securely', statusOpen: 'Open now', statusSoon: 'Closing soon', statusClosed: 'Closed or hours unavailable', map: 'Map', save: 'Save to My itineraries', saving: 'Saving itinerary…', saveError: 'Could not save. Please try again.' },
};

async function loadGoogleIdentity(): Promise<IdentityApi> {
  const current = (window as unknown as { google?: { accounts?: { id?: IdentityApi } } }).google?.accounts?.id;
  if (current) return current;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-roamly-google-identity]');
    const script = existing ?? document.createElement('script');
    const finish = () => {
      const identity = (window as unknown as { google?: { accounts?: { id?: IdentityApi } } }).google?.accounts?.id;
      if (identity) resolve(identity); else reject(new Error('Google Identity unavailable'));
    };
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Google Identity unavailable')), { once: true });
    if (!existing) { script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true; script.dataset.roamlyGoogleIdentity = 'true'; document.head.appendChild(script); }
  });
}

export function SharedMapView({ shareId }: { shareId: string }) {
  const [language, setLanguage] = useState<Language>('pt');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [clientId, setClientId] = useState('');
  const [map, setMap] = useState<SharedMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'login' | 'not-available' | 'failed' | ''>('');
  const [loginError, setLoginError] = useState('');
  const [dark, setDark] = useState(false);
  const [mapsKey, setMapsKey] = useState('');
  const [mapError, setMapError] = useState(false);
  const [selectedPlaceId, setSelectedPlaceId] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const googleButton = useRef<HTMLDivElement>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markerRegistryRef = useRef<ReturnType<typeof createMarkerRegistry> | null>(null);
  const placesRef = useRef<SharedPlace[]>([]);
  placesRef.current = map?.places ?? [];
  const copy = text[language];

  useEffect(() => {
    const stored = normalizeLanguage(localStorage.getItem('roamly-language'));
    setLanguage(stored);
    const currentDark = document.documentElement.dataset.theme === 'dark';
    setDark(currentDark);
    document.documentElement.lang = languageLocales[stored];
    Promise.all([
      fetch('/api/auth/config', { cache: 'no-store' }).then((response) => response.json() as Promise<{ clientId?: string }>).catch((): { clientId?: string } => ({})),
      fetch('/api/auth/session', { cache: 'no-store' }).then((response) => response.json() as Promise<{ user?: AuthUser | null }>).catch(() => ({ user: null })),
      fetch('/api/google-config', { cache: 'no-store' }).then((response) => response.json() as Promise<{ apiKey?: string }>).catch((): { apiKey?: string } => ({})),
    ]).then(([config, session, mapsConfig]) => { setClientId(config.clientId ?? ''); setUser(session.user ?? null); setMapsKey(mapsConfig.apiKey ?? ''); setLoading(false); });
  }, []);

  const loadSharedMap = useCallback(async () => {
    setError(''); setMap(null);
    try {
      const response = await fetch(`/api/shares?shareId=${encodeURIComponent(shareId)}`, { cache: 'no-store' });
      if (response.status === 401) { setError('login'); return; }
      if (response.status === 404) { setError('not-available'); return; }
      if (!response.ok) throw new Error('Request failed');
      const payload = await response.json() as { map?: SharedMap };
      if (!payload.map || !Array.isArray(payload.map.places)) throw new Error('Invalid response');
      setMap(payload.map);
    } catch { setError('failed'); }
  }, [shareId]);

  useEffect(() => { if (!loading && user) void loadSharedMap(); }, [loading, user, loadSharedMap]);

  useEffect(() => {
    const container = mapContainer.current;
    const places = map?.places ?? [];
    if (!container || !mapsKey || places.length === 0) return;
    let cancelled = false;
    loadGoogleMapsForShare(mapsKey, language).then(() => {
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
  }, [mapsKey, map]);

  useEffect(() => { googleMapRef.current?.setOptions({ colorScheme: dark ? 'DARK' : 'LIGHT' }); }, [dark]);

  useEffect(() => {
    const located = (map?.places ?? []).filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
    markerRegistryRef.current?.update(located.map((place, index) => ({ id: place.id, lat: place.lat!, lng: place.lng!, title: place.name, color: place.pinColor || (place.status === 'open' ? '#1f7a50' : place.status === 'soon' ? '#e1a43a' : '#9a7068'), glyph: String(index + 1), selected: place.id === selectedPlaceId })));
  }, [map, selectedPlaceId]);

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
    const next = normalizeLanguage(value); setLanguage(next); localStorage.setItem('roamly-language', next); document.documentElement.lang = languageLocales[next];
  }

  function toggleTheme() {
    const nextDark = !dark; setDark(nextDark); document.documentElement.dataset.theme = nextDark ? 'dark' : 'light';
    try { localStorage.setItem('roamly-theme', nextDark ? 'dark' : 'light'); } catch { /* Theme still works if storage is blocked. */ }
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

  function placeMapUrl(place: SharedPlace) {
    const params = new URLSearchParams({ api: '1', query: place.name + (place.address ? `, ${place.address}` : '') });
    if (place.placeId) params.set('query_place_id', place.placeId);
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  return <main className="shared-map-page">
    <header className="shared-map-header">
      <a className="shared-brand" href="/"><span><Compass size={21} /></span><strong>Easy Road Map</strong></a>
      <div className="shared-tools"><label className="language-picker" aria-label={language === 'en' ? 'Language' : language === 'es' ? 'Idioma' : 'Idioma'}><span>{language.toUpperCase()}</span><select value={language} onChange={(event) => changeLanguage(event.target.value)}><option value="pt">Português</option><option value="es">Español</option><option value="en">English</option></select></label><button className="theme-toggle" onClick={toggleTheme} aria-label={dark ? 'Light mode' : 'Dark mode'}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button></div>
    </header>
    <section className="shared-map-main">
      {loading ? <div className="share-state"><span className="search-spinner" /><p>{copy.loading}</p></div> : !user ? <section className="share-signin-card">
        <span className="share-hero-icon"><MapPin size={28} /></span><span className="share-eyebrow">{copy.label}</span><h1>{copy.signIn}</h1><p>{copy.signInHelp}</p>
        <div ref={googleButton} className="google-login-button" />
        {!clientId && <p className="auth-error">Google sign-in is unavailable right now.</p>}
        {loginBusy && <p className="share-muted">{copy.loading}</p>}{loginError && <p role="alert" className="auth-error">{loginError}</p>}
      </section> : error === 'login' ? <div className="share-state"><p>{copy.error}</p><button onClick={() => void loadSharedMap()}>↻</button></div> : error === 'not-available' ? <section className="share-signin-card"><span className="share-hero-icon"><MapPin size={28} /></span><h1>{copy.signIn}</h1><p>{copy.noInvitation}</p><strong className="share-user-email">{user.email}</strong><button className="share-switch-account" disabled={loginBusy} onClick={() => void switchAccount()}>{copy.switchAccount}</button>{loginError && <p role="alert" className="auth-error">{loginError}</p>}</section> : error === 'failed' ? <div className="share-state"><p>{copy.error}</p><button onClick={() => void loadSharedMap()}>{language === 'pt' ? 'Tentar novamente' : language === 'es' ? 'Reintentar' : 'Try again'}</button></div> : !map ? <div className="share-state"><span className="search-spinner" /><p>{copy.loading}</p></div> : <>
        <div className="shared-map-title"><span className="share-eyebrow">{copy.label}</span><h1>{map.name}</h1><p>{map.places.length} {copy.places}</p><button className="save-shared-map" onClick={() => void saveToMyItineraries()} disabled={saveBusy}><BookmarkPlus size={18} />{saveBusy ? copy.saving : copy.save}</button>{saveError && <p className="share-save-error" role="alert">{saveError}</p>}</div>
        <p className="shared-privacy-note">{copy.private}</p>
        {map.places.length === 0 ? <div className="share-empty-map"><MapPin size={24} /><p>{copy.noPlaces}</p></div> : <div className="shared-place-list">{map.places.map((place, index) => <article className={`shared-place-card ${selectedPlaceId === place.id ? 'selected' : ''}`} key={place.id} onClick={() => { setSelectedPlaceId(place.id); if (place.lat != null && place.lng != null) { googleMapRef.current?.panTo({ lat: place.lat, lng: place.lng }); googleMapRef.current?.setZoom(15); } }}>
          <div className="shared-place-photo">{place.photo ? <img src={place.photo} alt={place.name} /> : <MapPin size={24} />}<span>{String(index + 1).padStart(2, '0')}</span></div>
          <div className="shared-place-copy"><div className="shared-place-kicker">{place.category || copy.map}{place.rating ? ` · ★ ${place.rating}` : ''}</div><h2>{place.name}</h2><p>{place.address || copy.address}</p><div className="shared-place-hours"><Clock3 size={15} /><span>{place.statusLabel || place.hours || copy.hours}</span></div><a href={placeMapUrl(place)} target="_blank" rel="noreferrer">{copy.viewPlace}<ArrowUpRight size={15} /></a></div>
        </article>)}</div>}
      {map.places.some((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng)) && <section className="shared-map-canvas-wrap"><div className="share-map-canvas-heading"><strong>{copy.map}</strong><span>{map.places.length} {copy.places}</span></div><div ref={mapContainer} className="shared-google-map" aria-label={copy.map} />{!mapsKey && <p className="share-map-unavailable">{language === 'pt' ? 'O mapa interativo não está disponível agora. Os locais e as rotas continuam acessíveis abaixo.' : language === 'es' ? 'El mapa interactivo no está disponible ahora. Los lugares y las rutas siguen disponibles abajo.' : 'The interactive map is unavailable right now. Places and directions are still available below.'}</p>}{mapError && <p className="share-map-unavailable">{copy.error}</p>}</section>}
      <footer className="shared-map-footer"><p>{copy.private}</p><a href="/">Easy Road Map <Compass size={14} /></a></footer>
      </>}
    </section>
  </main>;
}
