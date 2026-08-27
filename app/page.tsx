'use client';

import {
  Bike, BusFront, Car, Check, ChevronDown, Clock3, Compass, Footprints, LocateFixed,
  Map as MapIcon, MapPin, Menu, Navigation, Plus, Search, SlidersHorizontal,
  Sparkles, Star, Trash2, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type PlaceStatus = 'open' | 'soon' | 'closed';
type Place = {
  id: string; placeId: string; name: string; category: string; address: string;
  hours: string; status: PlaceStatus; statusLabel: string; distance: string;
  note: string; photo: string; x: number; y: number; rating: string; destination?: string;
  lat?: number; lng?: number; googleMapsURI?: string; photoAttribution?: { name: string; url: string };
  pinColor?: string;
};

type MapsStatus = 'loading' | 'ready' | 'needs-key' | 'error';
type SearchPrediction = {
  placeId: string;
  mainText: string;
  secondaryText: string;
  distanceMeters?: number | null;
  modern?: google.maps.places.PlacePrediction;
};

const initialPlaces: Place[] = [
  {
    id: 'palacio', placeId: 'ChIJpy0369sQQg0R2lMStY3WFgw', name: 'Palácio Real de Madri',
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
    id: 'retiro', placeId: 'ChIJv_4a4ZYoQg0R2DJ8JCQx3jk', name: 'Parque El Retiro',
    category: 'Parque', address: 'Plaza de la Independencia, 7, Madrid',
    hours: '06:00 – 00:00', status: 'open', statusLabel: 'Aberto agora', distance: '1,6 km',
    note: 'Alugar um barco no lago',
    photo: 'https://images.unsplash.com/photo-1548919973-5cef591cdbc9?auto=format&fit=crop&w=1200&q=85',
    x: 78, y: 29, rating: '4,8', lat: 40.41526, lng: -3.68454,
  },
  {
    id: 'botin', placeId: 'ChIJW7dQGYYoQg0Rql2PUtWg3xw', name: 'Sobrino de Botín',
    category: 'Restaurante', address: 'C. de Cuchilleros, 17, Centro, Madrid',
    hours: '13:00 – 16:00, 20:00 – 00:00', status: 'closed', statusLabel: 'Abre às 20:00', distance: '950 m',
    note: 'Pedir o cochinillo assado',
    photo: 'https://images.unsplash.com/photo-1515443961218-a51367888e4b?auto=format&fit=crop&w=1200&q=85',
    x: 39, y: 68, rating: '4,3', lat: 40.414236, lng: -3.708073,
  },
];

const statusCopy: Record<PlaceStatus, string> = { open: 'Aberto', soon: 'Em breve', closed: 'Fechado' };
const statusPinColors: Record<PlaceStatus, string> = { open: '#1f7a50', soon: '#e1a43a', closed: '#9a7068' };
const pinColorChoices = ['#1f7a50', '#e1a43a', '#d65c52', '#2f80da', '#7b61a8'];
const removedPlacesStorageKey = 'roamly-removed-place-keys';

function placeKey(placeId: string, destination = 'Madri') {
  return `${placeId}:${destination.trim().toLocaleLowerCase('pt-BR')}`;
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
  const [places, setPlaces] = useState(initialPlaces);
  const [selectedId, setSelectedId] = useState('prado');
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
  const [mapPlaceCandidate, setMapPlaceCandidate] = useState<Place | null>(null);
  const [mapPlaceLoading, setMapPlaceLoading] = useState(false);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const addingPlaceKeysRef = useRef(new Set<string>());
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedNotes = localStorage.getItem('roamly-notes');
    try {
      const notes = savedNotes ? JSON.parse(savedNotes) as Record<string, string> : {};
      const savedMapsRaw = localStorage.getItem('roamly-maps');
      const savedMaps = savedMapsRaw === null ? null : JSON.parse(savedMapsRaw) as string[];
      const savedRefs = JSON.parse(localStorage.getItem('roamly-place-refs') ?? '[]') as Array<{ id: string; placeId: string; destination: string; note?: string; pinColor?: string }>;
      const removedKeys = new Set(JSON.parse(localStorage.getItem(removedPlacesStorageKey) ?? '[]') as string[]);
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
          return { ...place, note: notes[place.id] ?? savedRef?.note ?? place.note, pinColor: savedRef?.pinColor ?? place.pinColor };
        });
        const known = new Set(hydrated.map((place) => placeKey(place.placeId, place.destination ?? 'Madri')));
        const restored = savedRefs.filter((ref) => !known.has(placeKey(ref.placeId, ref.destination))).map((ref, index) => ({
          id: ref.id, placeId: ref.placeId, destination: ref.destination, note: ref.note ?? '', pinColor: ref.pinColor,
          name: 'Carregando lugar…', category: 'Google Places', address: '', hours: 'Consultando horários',
          status: 'closed' as PlaceStatus, statusLabel: 'Atualizando', distance: '—', photo: '',
          x: 45 + index * 4, y: 45 + index * 3, rating: '—',
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
    localStorage.setItem('roamly-place-refs', JSON.stringify(dedupePlaces(places).map((place) => ({ id: place.id, placeId: place.placeId, destination: place.destination ?? 'Madri', note: place.note, pinColor: place.pinColor }))));
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
    if (apiKey === null) return;
    if (!apiKey) { setMapsStatus('needs-key'); return; }
    let cancelled = false;
    setMapsStatus('loading'); setMapsError('');
    loadGoogleMaps(apiKey).then(() => {
      if (!google.maps.Map) throw new Error('A Maps JavaScript API precisa estar habilitada nesta chave.');
      if (!cancelled) setMapsStatus('ready');
    }).catch((error: Error) => {
      if (!cancelled) { setMapsStatus('error'); setMapsError(error.message || 'Não foi possível carregar o Google Maps.'); }
    });
    return () => { cancelled = true; };
  }, [apiKey]);

  useEffect(() => {
    if (mapsStatus !== 'ready') return;
    let cancelled = false;
    Promise.allSettled(places.map(async (savedPlace) => {
      const hydrated = await hydratePlaceById(savedPlace, userPosition);
      if (!cancelled) setPlaces((current) => dedupePlaces(current.map((item) => item.id === savedPlace.id ? { ...hydrated, note: item.note, pinColor: item.pinColor } : item)));
    }));
    return () => { cancelled = true; };
    // Refresh once after the official Google APIs become available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsStatus]);

  const visiblePlaces = useMemo(() => {
    const normalized = mapsStatus === 'ready' ? '' : query.trim().toLocaleLowerCase('pt-BR');
    return places.filter((place) => {
      const matches = !normalized || `${place.name} ${place.category} ${place.address}`.toLocaleLowerCase('pt-BR').includes(normalized);
      return (place.destination ?? 'Madri') === currentMap && matches && (!onlyOpen || place.status === 'open');
    }).sort((a, b) => {
      const aDistance = sortableDistance(a, userPosition);
      const bDistance = sortableDistance(b, userPosition);
      if (!Number.isFinite(aDistance) && Number.isFinite(bDistance)) return 1;
      if (Number.isFinite(aDistance) && !Number.isFinite(bDistance)) return -1;
      return aDistance !== bDistance ? aDistance - bDistance : a.name.localeCompare(b.name, 'pt-BR');
    });
  }, [places, query, onlyOpen, currentMap, mapsStatus, userPosition]);

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
            input: query, language: 'pt-BR', sessionToken: sessionTokenRef.current,
            locationBias: liveMap?.getBounds() ?? undefined,
            origin: userPosition ?? liveMap?.getCenter() ?? undefined,
          });
          if (!cancelled) setPredictions(suggestions.map((suggestion) => suggestion.placePrediction).filter((prediction): prediction is google.maps.places.PlacePrediction => Boolean(prediction)).slice(0, 6).map((prediction) => ({
            placeId: prediction.placeId, mainText: prediction.mainText?.toString() || prediction.text.toString(),
            secondaryText: prediction.secondaryText?.toString() || 'Google Maps', distanceMeters: prediction.distanceMeters, modern: prediction,
          })));
        } else if ((google.maps.places as unknown as { AutocompleteService?: typeof google.maps.places.AutocompleteService }).AutocompleteService) {
          const service = new google.maps.places.AutocompleteService();
          const response = await service.getPlacePredictions({ input: query, language: 'pt-BR', sessionToken: sessionTokenRef.current, locationBias: liveMap?.getBounds() ?? undefined, origin: userPosition ?? liveMap?.getCenter() ?? undefined });
          if (!cancelled) setPredictions(response.predictions.slice(0, 6).map((prediction) => ({
            placeId: prediction.place_id, mainText: prediction.structured_formatting.main_text,
            secondaryText: prediction.structured_formatting.secondary_text, distanceMeters: prediction.distance_meters,
          })));
        } else {
          if (!cancelled) { setPredictions([]); setMapsError('Habilite a Places API no Google Cloud para buscar e adicionar novos locais.'); }
        }
      } catch (error) {
        if (!cancelled) { setPredictions([]); setMapsError(error instanceof Error ? error.message : 'A busca do Google Places não respondeu.'); }
      } finally { if (!cancelled) setIsSearchingGoogle(false); }
    }, 280);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, mapsStatus, liveMap, userPosition]);

  useEffect(() => {
    if (!userPosition) return;
    setPlaces((current) => current.map((place) => place.lat != null && place.lng != null ? { ...place, distance: formatDistance(haversineMeters(userPosition, { lat: place.lat, lng: place.lng })) } : place));
    setLocationLabel('Localização ao vivo');
  }, [userPosition]);

  const selected = places.find((place) => place.id === selectedId) ?? places[0];

  function saveNote(value: string) {
    const next = places.map((place) => (place.id === selected.id ? { ...place, note: value } : place));
    setPlaces(next);
    localStorage.setItem('roamly-notes', JSON.stringify(Object.fromEntries(next.map((place) => [place.id, place.note]))));
  }

  function savePinColor(pinColor?: string) {
    if (!selected) return;
    setPlaces((current) => current.map((place) => place.id === selected.id ? { ...place, pinColor } : place));
    setToast(pinColor ? 'Cor do pin atualizada' : 'Cor automática restaurada');
  }

  function useMyLocation() {
    if (isLocating) return;
    if (userPosition && liveMap) {
      liveMap.panTo(userPosition);
      liveMap.setZoom(16);
      setLocationLabel('Localização ao vivo');
      setToast('Mapa centralizado na sua localização');
      return;
    }
    if (!navigator.geolocation) { setToast('Localização não disponível neste dispositivo'); return; }
    setIsLocating(true);
    setLocationLabel('Localizando…');
    navigator.geolocation.getCurrentPosition(
      (position) => { const next = { lat: position.coords.latitude, lng: position.coords.longitude }; setUserPosition(next); liveMap?.panTo(next); liveMap?.setZoom(16); setLocationLabel('Localização ao vivo'); setIsLocating(false); setToast('Mapa centralizado na sua localização'); },
      () => { setLocationLabel('Localização indisponível'); setIsLocating(false); setToast('Permita o acesso à localização para centralizar o mapa'); },
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
    if (!maps.includes(mapName)) setMaps((current) => [...current, mapName]);
    setCurrentMap(mapName);
    setToast(`Mapa “${mapName}” criado`); setNewMapName(''); setMapsOpen(false);
  }

  async function selectGooglePrediction(prediction: SearchPrediction) {
    if (!currentMap) { setMapsOpen(true); setToast('Crie um mapa antes de adicionar lugares'); return; }
    const key = placeKey(prediction.placeId, currentMap);
    const existing = places.find((item) => placeKey(item.placeId, item.destination ?? 'Madri') === key);
    if (existing) {
      setSelectedId(existing.id); setQuery(''); setPredictions([]);
      if (existing.lat != null && existing.lng != null) { liveMap?.panTo({ lat: existing.lat, lng: existing.lng }); liveMap?.setZoom(16); }
      setToast(`${existing.name} já está neste roteiro`);
      return;
    }
    if (addingPlaceKeysRef.current.has(key)) return;
    addingPlaceKeysRef.current.add(key);
    setIsSearchingGoogle(true);
    try {
      const savedPlace = await hydratePrediction(prediction, currentMap, userPosition);
      setPlaces((current) => dedupePlaces([...current, savedPlace]));
      try {
        const removed = JSON.parse(localStorage.getItem(removedPlacesStorageKey) ?? '[]') as string[];
        localStorage.setItem(removedPlacesStorageKey, JSON.stringify(removed.filter((removedKey) => removedKey !== key)));
      } catch { /* A fresh save can continue if old local preferences are malformed. */ }
      setSelectedId(savedPlace.id); setQuery(''); setPredictions([]);
      sessionTokenRef.current = null;
      if (savedPlace.lat != null && savedPlace.lng != null) { liveMap?.panTo({ lat: savedPlace.lat, lng: savedPlace.lng }); liveMap?.setZoom(16); }
      setToast(`${savedPlace.name} salvo pelo Google Places`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Não foi possível salvar este lugar');
    } finally { addingPlaceKeysRef.current.delete(key); setIsSearchingGoogle(false); }
  }

  async function selectPlaceFromMap(placeId: string) {
    if (!currentMap) { setMapsOpen(true); setToast('Crie um mapa antes de adicionar lugares'); return; }
    const key = placeKey(placeId, currentMap);
    const existing = places.find((item) => placeKey(item.placeId, item.destination ?? 'Madri') === key);
    if (existing) {
      setSelectedId(existing.id);
      setToast(`${existing.name} já está neste roteiro`);
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
      const hydrated = await hydratePlaceById(draft, userPosition);
      setMapPlaceCandidate(hydrated);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Não foi possível carregar este lugar');
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
      setSelectedId(existing.id);
      setMapPlaceCandidate(null);
      addingPlaceKeysRef.current.delete(key);
      setToast(`${existing.name} já está neste roteiro`);
      return;
    }
    setPlaces((current) => dedupePlaces([...current, mapPlaceCandidate]));
    try {
      const removed = JSON.parse(localStorage.getItem(removedPlacesStorageKey) ?? '[]') as string[];
      localStorage.setItem(removedPlacesStorageKey, JSON.stringify(removed.filter((removedKey) => removedKey !== key)));
    } catch { /* A fresh save can continue if old local preferences are malformed. */ }
    setSelectedId(mapPlaceCandidate.id);
    setMapPlaceCandidate(null);
    addingPlaceKeysRef.current.delete(key);
    setToast(`${mapPlaceCandidate.name} adicionado ao roteiro`);
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
    setRemoveConfirmOpen(false);
    setRouteOpen(false);
    setToast(`${selected.name} removido do roteiro`);
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
    }
    setRouteOpen(false);
    setRemoveConfirmOpen(false);
    setToast(`Mapa “${mapPendingDelete}” excluído`);
    setMapPendingDelete(null);
  }

  function connectGoogleMaps(key: string) {
    const cleanKey = key.trim();
    if (!cleanKey) return;
    localStorage.setItem('roamly-google-maps-key', cleanKey);
    setApiKey(cleanKey);
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
        <button className="trip-switcher" onClick={() => setMapsOpen(true)} aria-label="Trocar mapa de viagem">
          <span className="trip-pin"><MapPin size={17} fill="currentColor" /></span>
          <span><small>MEU ROTEIRO</small><strong>{currentMap || 'Criar mapa'}</strong></span><ChevronDown size={17} />
        </button>
        <div className="header-actions"><span className={`live-pill ${mapsStatus === 'ready' ? 'online' : ''}`}><i />{mapsStatus === 'ready' ? 'Maps ao vivo' : 'Conectando'}</span><button className="avatar" aria-label="Abrir perfil">AS</button></div>
      </header>

      <section className="toolbar" aria-label="Ferramentas do mapa">
        <div className="search-wrap">
          <Search size={19} />
          <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mapsStatus === 'ready' ? 'Buscar no Google Maps' : 'Buscar no seu roteiro'} aria-label="Buscar lugares no Google Maps" autoComplete="off" />
          {isSearchingGoogle && <span className="search-spinner" aria-label="Buscando" />}
          {query && <button onClick={() => setQuery('')} aria-label="Limpar busca"><X size={16} /></button>}
          {mapsStatus === 'ready' && query.trim().length >= 2 && (
            <div className="google-results" role="listbox" aria-label="Resultados do Google Maps">
              {predictions.map((prediction) => {
                const saved = places.some((item) => placeKey(item.placeId, item.destination ?? 'Madri') === placeKey(prediction.placeId, currentMap));
                return <button key={prediction.placeId} onClick={() => !saved && selectGooglePrediction(prediction)} role="option" disabled={saved} aria-disabled={saved}>
                  <span className="result-pin"><MapPin size={16} /></span>
                  <span><strong>{prediction.mainText}</strong><small>{prediction.secondaryText}</small></span>
                  {saved ? <em className="saved-result"><Check size={13} /> Salvo</em> : prediction.distanceMeters != null && <em>{formatDistance(prediction.distanceMeters)}</em>}
                </button>;
              })}
              {!isSearchingGoogle && predictions.length === 0 && <p>Nenhum resultado encontrado.</p>}
              {mapsError && <p className="search-api-warning">{mapsError}</p>}
              <div className="google-attribution"><img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" /></div>
            </div>
          )}
        </div>
        <button className={`filter-button ${onlyOpen ? 'active' : ''}`} onClick={() => setFilterOpen((value) => !value)} aria-label="Filtrar lugares">
          <SlidersHorizontal size={19} /><span>Filtros</span>{onlyOpen && <i />}
        </button>
        {filterOpen && (
          <div className="filter-popover">
            <div><strong>Mostrar no mapa</strong><span>{visiblePlaces.length} lugares</span></div>
            <button onClick={() => setOnlyOpen((value) => !value)}>
              <span className={`checkbox ${onlyOpen ? 'checked' : ''}`}>{onlyOpen && <Check size={13} />}</span>
              Somente abertos agora
            </button>
          </div>
        )}
      </section>

      <section className="workspace">
        <aside className="desktop-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">QUARTA, 26 AGO</span><h1>{currentMap ? `Seu roteiro em ${currentMap}` : 'Crie seu primeiro roteiro'}</h1><p>{visiblePlaces.length} lugares</p></div>
          </div>
          <div className="progress-card"><span><Sparkles size={15} /> Bom momento para explorar</span><p>2 lugares estão abertos e perto de você.</p></div>
          <div className="place-list desktop-list">
            {visiblePlaces.map((place) => <PlaceRow key={place.id} place={place} active={place.id === selected.id} onSelect={() => setSelectedId(place.id)} />)}
          </div>
          <button className="add-place-button" onClick={() => { setQuery(''); searchInputRef.current?.focus(); }}><Plus size={18} /> Adicionar pelo Google Maps</button>
        </aside>

        <div className={`map-area ${view === 'list' ? 'mobile-list-view' : ''}`}>
          <div className={`map-canvas ${mapsStatus === 'ready' ? 'map-canvas-hidden' : ''}`} style={{ '--map-scale': zoom } as React.CSSProperties}>
            <div className="map-text label-sol">SOL</div><div className="map-text label-retiro">RETIRO</div>
            <div className="map-text street-one">Calle de Alcalá</div><div className="map-text street-two">Gran Vía</div>
            <div className="park park-one" /><div className="park park-two" /><div className="water" />
            <div className="user-location" aria-label="Sua localização"><span /><i /><em>{locationLabel}</em></div>
            {visiblePlaces.map((place) => (
              <button key={place.id} className={`map-marker ${place.status} ${selected.id === place.id ? 'selected' : ''}`}
                style={{ left: `${place.x}%`, top: `${place.y}%`, background: getPinColor(place) }} onClick={() => setSelectedId(place.id)}
                aria-label={`${place.name}: ${place.statusLabel}`}>
                <span>{place.category === 'Restaurante' ? 'R' : place.category === 'Parque' ? 'P' : '◆'}</span>
              </button>
            ))}
            {visiblePlaces.length === 0 && <div className="empty-map"><Search size={24} /><strong>Nenhum lugar encontrado</strong><span>Tente buscar outro nome ou remover os filtros.</span></div>}
          </div>
          {mapsStatus === 'ready' && <LiveGoogleMap places={visiblePlaces} selectedId={selectedId} onSelect={setSelectedId} onMapPlaceClick={selectPlaceFromMap} onUserPosition={setUserPosition} onMapReady={setLiveMap} />}
          {mapsStatus !== 'ready' && <MapsConnection status={mapsStatus} error={mapsError} onConnect={connectGoogleMaps} />}
          {mapsStatus === 'ready' && <div className="map-add-hint"><Plus size={15} /> Toque em um local do mapa para adicionar</div>}
          {mapPlaceLoading && <div className="maps-connect-card compact map-place-loading"><span className="search-spinner" /><strong>Carregando local…</strong></div>}
          <div className="map-controls"><button onClick={() => liveMap ? liveMap.setZoom(Math.min(20, (liveMap.getZoom() ?? 13) + 1)) : setZoom((value) => Math.min(1.14, value + .04))} aria-label="Aumentar zoom">+</button><button onClick={() => liveMap ? liveMap.setZoom(Math.max(2, (liveMap.getZoom() ?? 13) - 1)) : setZoom((value) => Math.max(.9, value - .04))} aria-label="Diminuir zoom">−</button></div>
          <button className={`locate-button ${isLocating ? 'locating' : ''}`} onClick={useMyLocation} aria-label="Centralizar na minha localização" title="Centralizar na minha localização" disabled={mapsStatus !== 'ready'}><LocateFixed size={21} /></button>

          <div className="mobile-list">
            <div className="mobile-list-heading"><div><span className="eyebrow">QUARTA, 26 AGO</span><h2>{currentMap ? `Seu roteiro em ${currentMap}` : 'Crie seu primeiro roteiro'}</h2></div><span>{visiblePlaces.length} lugares</span></div>
            <div className="place-list">{visiblePlaces.map((place) => <PlaceRow key={place.id} place={place} active={place.id === selected.id} onSelect={() => setSelectedId(place.id)} />)}</div>
          </div>

          {view === 'map' && visiblePlaces.some((place) => place.id === selected.id) && (
            <article className="place-card">
              <button className="close-card" onClick={() => setSelectedId('')} aria-label="Fechar detalhes"><X size={18} /></button>
              <div className="place-photo">
                <span className="photo-placeholder"><MapPin size={30} /></span>
                {selected.photo && <img src={selected.photo} alt={`Foto de ${selected.name}`} />}
                <span className={`status-pill ${selected.status}`}><i />{selected.statusLabel}</span><span className="rating"><Star size={13} fill="currentColor" /> {selected.rating}</span>
                {selected.photoAttribution && <a className="photo-credit" href={selected.photoAttribution.url} target="_blank" rel="noreferrer">Foto: {selected.photoAttribution.name}</a>}
              </div>
              <div className="place-content">
                <div className="place-title"><div><span>{selected.category}</span><h2>{selected.name}</h2></div><strong>{selected.distance}</strong></div>
                <div className="meta-row"><MapPin size={16} /><span>{selected.address}</span></div>
                <div className="meta-row"><Clock3 size={16} /><span><strong>{selected.statusLabel}</strong> · Hoje, {selected.hours}</span></div>
                <div className="pin-color-picker"><span>COR DO PIN</span><div role="group" aria-label="Escolher cor do pin">
                  <button className={!selected.pinColor ? 'active auto-color' : 'auto-color'} onClick={() => savePinColor(undefined)} aria-label="Usar cor automática pelo horário" title="Cor automática pelo horário"><Sparkles size={13} /></button>
                  {pinColorChoices.map((color) => <button key={color} className={selected.pinColor === color ? 'active' : ''} style={{ '--choice-color': color } as React.CSSProperties} onClick={() => savePinColor(color)} aria-label={`Usar a cor ${color}`} />)}
                </div></div>
                <label className="note-field"><span>NOTA PESSOAL</span><input value={selected.note} onChange={(event) => saveNote(event.target.value)} /></label>
                <div className="place-actions">
                  <button className="remove-place-button" onClick={() => setRemoveConfirmOpen(true)}><Trash2 size={16} /> Remover</button>
                  <button className="go-button" onClick={openRouteOptions}><Navigation size={19} fill="currentColor" /> Ir com Maps</button>
                </div>
              </div>
            </article>
          )}
        </div>
      </section>

      <nav className="bottom-nav" aria-label="Navegação principal">
        <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}><MapIcon size={21} /><span>Mapa</span></button>
        <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><Menu size={21} /><span>Lista</span></button>
        <button onClick={() => setMapsOpen(true)}><Plus size={22} /><span>Novo mapa</span></button>
      </nav>

      {routeOpen && (
        <div className="modal-backdrop" onClick={() => setRouteOpen(false)}>
          <section className="route-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Escolher meio de transporte">
            <div className="sheet-handle" />
            <div className="sheet-heading"><div><span>ROTA PARA</span><h2>{selected.name}</h2><p>Saindo da sua localização</p></div><button onClick={() => setRouteOpen(false)} aria-label="Fechar"><X size={19} /></button></div>
            <div className="travel-grid">
              <button onClick={() => openDirections('walking')}><Footprints size={24} /><strong>A pé</strong><span>Abrir rota</span></button>
              <button onClick={() => openDirections('driving')}><Car size={24} /><strong>Carro</strong><span>Abrir rota</span></button>
              <button onClick={() => openDirections('bicycling')}><Bike size={24} /><strong>Bicicleta</strong><span>Abrir rota</span></button>
              <button onClick={() => openDirections('transit')}><BusFront size={24} /><strong>Transporte</strong><span>Abrir rota</span></button>
            </div><p className="google-note">A rota será aberta no Google Maps.</p>
          </section>
        </div>
      )}

      {removeConfirmOpen && selected && (
        <div className="modal-backdrop" onClick={() => setRemoveConfirmOpen(false)}>
          <section className="confirm-modal" onClick={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="remove-place-title" aria-describedby="remove-place-description">
            <span className="confirm-icon"><Trash2 size={23} /></span>
            <div><span className="eyebrow">REMOVER DO ROTEIRO</span><h2 id="remove-place-title">Remover {selected.name}?</h2><p id="remove-place-description">O local e a nota pessoal serão retirados deste mapa.</p></div>
            <div className="confirm-actions"><button onClick={() => setRemoveConfirmOpen(false)}>Cancelar</button><button className="confirm-remove" onClick={removeSelectedPlace}><Trash2 size={16} /> Remover local</button></div>
          </section>
        </div>
      )}

      {mapsOpen && (
        <div className="modal-backdrop" onClick={() => setMapsOpen(false)}>
          <section className="maps-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Seus mapas">
            <div className="modal-heading"><div><span>SEUS MAPAS</span><h2>Para onde vamos?</h2></div><button onClick={() => setMapsOpen(false)} aria-label="Fechar"><X size={19} /></button></div>
            {maps.length === 0 && <div className="places-unavailable maps-empty"><MapIcon size={23} /><strong>Nenhum mapa criado</strong><span>Crie um destino abaixo para começar seu roteiro.</span></div>}
            {maps.map((mapName, index) => (
              <div className="map-option-row" key={mapName}>
                <button className={`map-option ${currentMap === mapName ? 'selected' : ''}`} onClick={() => { setCurrentMap(mapName); setMapsOpen(false); setToast(`Mapa “${mapName}” aberto`); }}>
                  <span className={`map-thumb ${index === 0 ? 'madrid' : 'lisbon'}`}>{mapName.slice(0,3).toUpperCase()}</span>
                  <span><strong>{mapName}</strong><small>{places.filter((place) => (place.destination ?? 'Madri') === mapName).length ? `${places.filter((place) => (place.destination ?? 'Madri') === mapName).length} lugares salvos` : 'Nenhum lugar salvo'}</small></span>
                  {currentMap === mapName && <Check size={19} />}
                </button>
                <button className="delete-map-button" onClick={() => setMapPendingDelete(mapName)} aria-label={`Excluir mapa ${mapName}`} title={`Excluir ${mapName}`}><Trash2 size={17} /></button>
              </div>
            ))}
            <div className="new-map-form"><label htmlFor="new-map">NOVO DESTINO</label><div><input id="new-map" value={newMapName} onChange={(event) => setNewMapName(event.target.value)} placeholder="Ex.: Roma" onKeyDown={(event) => event.key === 'Enter' && createMap()} /><button onClick={createMap}><Plus size={18} /> Criar mapa</button></div></div>
          </section>
        </div>
      )}
      {mapPlaceCandidate && (
        <div className="modal-backdrop map-place-backdrop" onClick={() => setMapPlaceCandidate(null)}>
          <section className="maps-modal map-place-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="map-place-title">
            <div className="modal-heading"><div><span>LOCAL DO GOOGLE MAPS</span><h2 id="map-place-title">Adicionar ao roteiro?</h2></div><button onClick={() => setMapPlaceCandidate(null)} aria-label="Fechar"><X size={19} /></button></div>
            <div className="map-place-preview">
              <span className="map-place-photo"><MapPin size={24} />{mapPlaceCandidate.photo && <img src={mapPlaceCandidate.photo} alt="" />}</span>
              <span><strong>{mapPlaceCandidate.name}</strong><small>{mapPlaceCandidate.address}</small><em>{mapPlaceCandidate.category} · {mapPlaceCandidate.statusLabel}</em>{mapPlaceCandidate.photoAttribution && <a href={mapPlaceCandidate.photoAttribution.url} target="_blank" rel="noreferrer">Foto: {mapPlaceCandidate.photoAttribution.name}</a>}</span>
            </div>
            <div className="confirm-actions map-place-actions"><button onClick={() => setMapPlaceCandidate(null)}>Cancelar</button><button className="confirm-add" onClick={addMapPlaceCandidate}><Plus size={16} /> Adicionar ao mapa</button></div>
            <div className="google-attribution modal-google"><img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" /></div>
          </section>
        </div>
      )}
      {mapPendingDelete && (
        <div className="modal-backdrop map-delete-backdrop" onClick={() => setMapPendingDelete(null)}>
          <section className="confirm-modal" onClick={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="delete-map-title" aria-describedby="delete-map-description">
            <span className="confirm-icon"><Trash2 size={23} /></span>
            <div><span className="eyebrow">EXCLUIR MAPA</span><h2 id="delete-map-title">Excluir {mapPendingDelete}?</h2><p id="delete-map-description">O mapa e todos os locais salvos nele serão removidos deste dispositivo.</p></div>
            <div className="confirm-actions"><button onClick={() => setMapPendingDelete(null)}>Cancelar</button><button className="confirm-remove" onClick={deleteMap}><Trash2 size={16} /> Excluir mapa</button></div>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    </main>
  );
}

function PlaceRow({ place, active, onSelect }: { place: Place; active: boolean; onSelect: () => void }) {
  return (
    <button className={`place-row ${active ? 'active' : ''}`} onClick={onSelect}>
      <span className="row-photo"><MapPin size={19} />{place.photo && <img src={place.photo} alt="" loading="lazy" />}<i className={place.status} /></span>
      <span className="row-copy"><strong>{place.name}</strong><small>{place.category} · {place.distance}</small><em className={place.status}>{place.statusLabel}</em></span>
      <span className={`status-dot ${place.status}`} title={statusCopy[place.status]} />
    </button>
  );
}

const placeFields = [
  'id', 'displayName', 'formattedAddress', 'location', 'viewport', 'primaryTypeDisplayName',
  'rating', 'photos', 'currentOpeningHours', 'regularOpeningHours', 'utcOffsetMinutes', 'googleMapsURI', 'businessStatus',
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

function loadGoogleMaps(apiKey: string) {
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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&language=pt-BR&region=BR&libraries=places,marker&callback=__roamlyGoogleMapsReady`;
    script.onerror = () => reject(new Error('Falha ao carregar o Google Maps. Confira a chave e as APIs habilitadas.'));
    document.head.appendChild(script);
  });
}

function LiveGoogleMap({
  places, selectedId, onSelect, onMapPlaceClick, onUserPosition, onMapReady,
}: {
  places: Place[]; selectedId: string; onSelect: (id: string) => void;
  onMapPlaceClick: (placeId: string) => void;
  onUserPosition: (position: google.maps.LatLngLiteral) => void;
  onMapReady: (map: google.maps.Map) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const userMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const onMapPlaceClickRef = useRef(onMapPlaceClick);

  useEffect(() => { onMapPlaceClickRef.current = onMapPlaceClick; }, [onMapPlaceClick]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const first = places.find((place) => place.lat != null && place.lng != null);
    const map = new google.maps.Map(containerRef.current, {
      center: first?.lat != null && first.lng != null ? { lat: first.lat, lng: first.lng } : { lat: 40.4168, lng: -3.7038 },
      zoom: 14, mapId: 'DEMO_MAP_ID', disableDefaultUI: true, clickableIcons: true,
      gestureHandling: 'greedy', backgroundColor: '#edf0e9',
    });
    map.addListener('click', (event: google.maps.MapMouseEvent) => {
      const iconEvent = event as google.maps.IconMouseEvent;
      if (!iconEvent.placeId) return;
      iconEvent.stop();
      onMapPlaceClickRef.current(iconEvent.placeId);
    });
    mapRef.current = map; onMapReady(map);
  }, [onMapReady, places]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker) => { marker.map = null; });
    markersRef.current = places.filter((place) => place.lat != null && place.lng != null).map((place) => {
      const pin = new google.maps.marker.PinElement({
        background: getPinColor(place), borderColor: '#ffffff', glyphColor: '#ffffff',
        glyphText: place.category === 'Restaurante' ? 'R' : place.category === 'Parque' ? 'P' : '•',
        scale: place.id === selectedId ? 1.28 : 1.05,
      });
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map, position: { lat: place.lat!, lng: place.lng! }, title: `${place.name} — ${place.statusLabel}`,
        content: pin, gmpClickable: true, zIndex: place.id === selectedId ? 20 : 10,
      });
      marker.addEventListener('gmp-click', () => onSelect(place.id));
      return marker;
    });
  }, [places, selectedId, onSelect]);

  useEffect(() => {
    const place = places.find((item) => item.id === selectedId);
    if (place?.lat != null && place.lng != null && mapRef.current) mapRef.current.panTo({ lat: place.lat, lng: place.lng });
  }, [selectedId, places]);

  useEffect(() => {
    if (!navigator.geolocation || !mapRef.current) return;
    const watchId = navigator.geolocation.watchPosition((position) => {
      const next = { lat: position.coords.latitude, lng: position.coords.longitude };
      onUserPosition(next);
      if (!userMarkerRef.current) {
        const dot = document.createElement('div');
        dot.className = 'live-user-marker';
        dot.setAttribute('aria-label', 'Sua localização ao vivo');
        userMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({ map: mapRef.current, position: next, title: 'Sua localização ao vivo', content: dot, zIndex: 50 });
        mapRef.current?.panTo(next);
      } else userMarkerRef.current.position = next;
    }, () => undefined, { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [onUserPosition]);

  return <div ref={containerRef} className="live-google-map" aria-label="Mapa ao vivo do Google Maps" />;
}

function MapsConnection({ status, error, onConnect }: { status: MapsStatus; error: string; onConnect: (key: string) => void }) {
  const [key, setKey] = useState('');
  if (status === 'loading') return <div className="maps-connect-card compact"><span className="search-spinner" /><strong>Carregando Google Maps…</strong></div>;
  return (
    <div className="maps-connect-card">
      <span className="google-badge"><MapIcon size={23} /></span>
      <div><small>MAPA AO VIVO</small><h2>Conectar Google Maps</h2><p>Use uma chave com Maps JavaScript API e Places API (New) habilitadas. Restrinja-a a este domínio.</p></div>
      {error && <p className="maps-error">{error}</p>}
      <div className="key-form"><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Cole sua chave do Google Maps" aria-label="Chave do Google Maps" onKeyDown={(event) => event.key === 'Enter' && onConnect(key)} /><button onClick={() => onConnect(key)}>Conectar</button></div>
      <span className="key-note">A chave fica somente neste navegador. Para publicar sem esta etapa, configure-a no ambiente do site.</span>
    </div>
  );
}

async function hydrateModernPlace(ModernPlace: typeof google.maps.places.Place, savedPlace: Place, userPosition: google.maps.LatLngLiteral | null) {
  const livePlace = new ModernPlace({ id: savedPlace.placeId, requestedLanguage: 'pt-BR' });
  await livePlace.fetchFields({ fields: placeFields });
  return toSavedPlace(livePlace, savedPlace.destination ?? 'Madri', savedPlace.note, savedPlace.id, userPosition);
}

async function hydrateModernPlaceFromPrediction(prediction: google.maps.places.PlacePrediction, destination: string, userPosition: google.maps.LatLngLiteral | null) {
  const livePlace = prediction.toPlace();
  await livePlace.fetchFields({ fields: placeFields });
  return toSavedPlace(livePlace, destination, '', `${livePlace.id}-${destination}`, userPosition);
}

async function hydratePlaceById(savedPlace: Place, userPosition: google.maps.LatLngLiteral | null) {
  const ModernPlace = (google.maps.places as unknown as { Place?: typeof google.maps.places.Place }).Place;
  if (ModernPlace) {
    return hydrateModernPlace(ModernPlace, savedPlace, userPosition);
  }
  return toSavedLegacyPlace(await fetchLegacyPlaceDetails(savedPlace.placeId), savedPlace.destination ?? 'Madri', savedPlace.note, savedPlace.id, userPosition);
}

async function hydratePrediction(prediction: SearchPrediction, destination: string, userPosition: google.maps.LatLngLiteral | null) {
  if (prediction.modern) {
    return hydrateModernPlaceFromPrediction(prediction.modern, destination, userPosition);
  }
  return toSavedLegacyPlace(await fetchLegacyPlaceDetails(prediction.placeId), destination, '', `${prediction.placeId}-${destination}`, userPosition);
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

function toSavedLegacyPlace(result: google.maps.places.PlaceResult, destination: string, note: string, id: string, userPosition: google.maps.LatLngLiteral | null): Place {
  const location = result.geometry?.location?.toJSON();
  const schedule = getLegacySchedule(result.opening_hours, result.utc_offset_minutes ?? 0);
  const photo = result.photos?.[0];
  const attribution = parseLegacyAttribution(photo?.html_attributions?.[0]);
  return {
    id, placeId: result.place_id || id, destination, note,
    name: result.name || 'Lugar sem nome', category: formatPlaceType(result.types?.[0]),
    address: result.formatted_address || 'Endereço não informado',
    hours: schedule.hours, status: schedule.status, statusLabel: schedule.label,
    distance: location && userPosition ? formatDistance(haversineMeters(userPosition, location)) : '—',
    photo: photo?.getUrl({ maxWidth: 1200, maxHeight: 800 }) || '', photoAttribution: attribution,
    x: 50, y: 50, rating: result.rating?.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) || '—',
    lat: location?.lat, lng: location?.lng, googleMapsURI: result.url,
  };
}

function getLegacySchedule(openingHours: google.maps.places.PlaceOpeningHours | undefined, utcOffsetMinutes: number): { status: PlaceStatus; label: string; hours: string } {
  if (!openingHours?.periods?.length) return { status: 'closed', label: 'Horário não informado', hours: 'Consulte o Google Maps' };
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
  const hours = todaysPeriod ? `${formatClock(todaysPeriod.open.hours, todaysPeriod.open.minutes)} – ${todaysPeriod.close ? formatClock(todaysPeriod.close.hours, todaysPeriod.close.minutes) : '24h'}` : 'Fechado hoje';
  if (current) {
    const comparableNow = nowMinutes < current.start ? nowMinutes + week : nowMinutes;
    const remaining = current.end - comparableNow;
    return remaining <= 60 ? { status: 'soon', label: `Fecha em ${remaining} min`, hours } : { status: 'open', label: 'Aberto agora', hours };
  }
  const next = periods.map((period) => ({ ...period, wait: (period.start - nowMinutes + week) % week })).filter((period) => period.wait > 0).sort((a, b) => a.wait - b.wait)[0];
  if (!next) return { status: 'closed', label: 'Fechado', hours };
  return next.wait <= 60 ? { status: 'soon', label: `Abre em ${next.wait} min`, hours } : { status: 'closed', label: `Abre às ${formatClock(next.open.hours, next.open.minutes)}`, hours };
}

function formatPlaceType(type?: string) {
  if (!type) return 'Lugar';
  const known: Record<string, string> = { restaurant: 'Restaurante', museum: 'Museu', park: 'Parque', tourist_attraction: 'Atração', lodging: 'Hotel', cafe: 'Café', bar: 'Bar', store: 'Loja' };
  return known[type] || type.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function parseLegacyAttribution(html?: string): { name: string; url: string } | undefined {
  if (!html) return undefined;
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const link = documentNode.querySelector('a');
  return link?.href ? { name: link.textContent?.trim() || 'Google Maps', url: link.href } : undefined;
}

function toSavedPlace(livePlace: google.maps.places.Place, destination: string, note: string, id: string, userPosition: google.maps.LatLngLiteral | null): Place {
  const location = livePlace.location?.toJSON();
  const hours = livePlace.currentOpeningHours ?? livePlace.regularOpeningHours;
  const schedule = getLiveSchedule(hours, livePlace.utcOffsetMinutes ?? 0);
  const photo = livePlace.photos?.[0];
  const attribution = photo?.authorAttributions?.[0];
  return {
    id, placeId: livePlace.id, destination, note,
    name: livePlace.displayName || 'Lugar sem nome',
    category: livePlace.primaryTypeDisplayName || 'Lugar',
    address: livePlace.formattedAddress || 'Endereço não informado',
    hours: schedule.hours, status: schedule.status, statusLabel: schedule.label,
    distance: location && userPosition ? formatDistance(haversineMeters(userPosition, location)) : '—',
    photo: photo?.getURI({ maxWidth: 1200, maxHeight: 800 }) || '',
    photoAttribution: attribution?.uri ? { name: attribution.displayName, url: attribution.uri } : undefined,
    x: 50, y: 50, rating: livePlace.rating?.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) || '—',
    lat: location?.lat, lng: location?.lng, googleMapsURI: livePlace.googleMapsURI ?? undefined,
  };
}

function getLiveSchedule(openingHours: google.maps.places.OpeningHours | null | undefined, utcOffsetMinutes: number): { status: PlaceStatus; label: string; hours: string } {
  if (!openingHours?.periods?.length) return { status: 'closed', label: 'Horário não informado', hours: 'Consulte o Google Maps' };
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
  const hours = todaysPeriod ? `${formatClock(todaysPeriod.open.hour, todaysPeriod.open.minute)} – ${todaysPeriod.close ? formatClock(todaysPeriod.close.hour, todaysPeriod.close.minute) : '24h'}` : 'Fechado hoje';
  if (current) {
    const comparableNow = nowMinutes < current.start ? nowMinutes + week : nowMinutes;
    const remaining = current.end - comparableNow;
    return remaining <= 60 ? { status: 'soon', label: `Fecha em ${remaining} min`, hours } : { status: 'open', label: 'Aberto agora', hours };
  }
  const next = periods.map((period) => ({ ...period, wait: (period.start - nowMinutes + week) % week })).filter((period) => period.wait > 0).sort((a, b) => a.wait - b.wait)[0];
  if (!next) return { status: 'closed', label: 'Fechado', hours };
  return next.wait <= 60 ? { status: 'soon', label: `Abre em ${next.wait} min`, hours } : { status: 'closed', label: `Abre às ${formatClock(next.open.hour, next.open.minute)}`, hours };
}

function formatClock(hour: number, minute: number) { return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`; }

function haversineMeters(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) {
  const toRad = (value: number) => value * Math.PI / 180;
  const radius = 6371e3;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistance(meters: number) { return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`; }

function sortableDistance(place: Place, userPosition: google.maps.LatLngLiteral | null) {
  if (userPosition && place.lat != null && place.lng != null) return haversineMeters(userPosition, { lat: place.lat, lng: place.lng });
  if (place.distance.endsWith(' km')) return Number(place.distance.replace(' km', '').replace('.', '').replace(',', '.')) * 1000;
  if (place.distance.endsWith(' m')) return Number(place.distance.replace(' m', '').replace('.', ''));
  return Number.POSITIVE_INFINITY;
}

function getPinColor(place: Place) { return place.pinColor || statusPinColors[place.status]; }
