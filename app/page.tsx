'use client';

import {
  Bike, BusFront, Car, Check, ChevronDown, Clock3, Footprints, LocateFixed,
  Map as MapIcon, MapPin, Menu, Navigation, Plus, Search, SlidersHorizontal,
  Sparkles, Star, X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type PlaceStatus = 'open' | 'soon' | 'closed';
type Place = {
  id: string; placeId: string; name: string; category: string; address: string;
  hours: string; status: PlaceStatus; statusLabel: string; distance: string;
  note: string; photo: string; x: number; y: number; rating: string; destination?: string;
};

const initialPlaces: Place[] = [
  {
    id: 'palacio', placeId: 'ChIJpy0369sQQg0R2lMStY3WFgw', name: 'Palácio Real de Madri',
    category: 'História & cultura', address: 'C. de Bailén, s/n, Centro, Madrid',
    hours: '10:00 – 19:00', status: 'open', statusLabel: 'Aberto agora', distance: '1,2 km',
    note: 'Comprar ingresso antecipado',
    photo: 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?auto=format&fit=crop&w=1200&q=85',
    x: 25, y: 34, rating: '4,7',
  },
  {
    id: 'prado', placeId: 'ChIJ7aLYZp0oQg0RWoitk33wlBA', name: 'Museu do Prado',
    category: 'Museu', address: 'C. de Ruiz de Alarcón, 23, Retiro, Madrid',
    hours: '10:00 – 20:00', status: 'soon', statusLabel: 'Fecha em 45 min', distance: '850 m',
    note: 'Ver a ala de Goya primeiro',
    photo: 'https://images.unsplash.com/photo-1543783207-ec64e4d95325?auto=format&fit=crop&w=1200&q=85',
    x: 64, y: 49, rating: '4,8',
  },
  {
    id: 'retiro', placeId: 'ChIJv_4a4ZYoQg0R2DJ8JCQx3jk', name: 'Parque El Retiro',
    category: 'Parque', address: 'Plaza de la Independencia, 7, Madrid',
    hours: '06:00 – 00:00', status: 'open', statusLabel: 'Aberto agora', distance: '1,6 km',
    note: 'Alugar um barco no lago',
    photo: 'https://images.unsplash.com/photo-1548919973-5cef591cdbc9?auto=format&fit=crop&w=1200&q=85',
    x: 78, y: 29, rating: '4,8',
  },
  {
    id: 'botin', placeId: 'ChIJW7dQGYYoQg0Rql2PUtWg3xw', name: 'Sobrino de Botín',
    category: 'Restaurante', address: 'C. de Cuchilleros, 17, Centro, Madrid',
    hours: '13:00 – 16:00, 20:00 – 00:00', status: 'closed', statusLabel: 'Abre às 20:00', distance: '950 m',
    note: 'Pedir o cochinillo assado',
    photo: 'https://images.unsplash.com/photo-1515443961218-a51367888e4b?auto=format&fit=crop&w=1200&q=85',
    x: 39, y: 68, rating: '4,3',
  },
];

const statusCopy: Record<PlaceStatus, string> = { open: 'Aberto', soon: 'Em breve', closed: 'Fechado' };

const suggestedPlaces: Place[] = [
  {
    id: 'mercado', placeId: 'ChIJX4HLK4YoQg0R9RLBjE2zfok', name: 'Mercado de San Miguel',
    category: 'Gastronomia', address: 'Pl. de San Miguel, s/n, Centro, Madrid',
    hours: '10:00 – 00:00', status: 'open', statusLabel: 'Aberto agora', distance: '1,1 km',
    note: '', photo: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=85',
    x: 32, y: 57, rating: '4,4',
  },
  {
    id: 'reina-sofia', placeId: 'ChIJG4DOU3woQg0RG3f4hq0Z6UA', name: 'Museu Reina Sofía',
    category: 'Museu', address: 'C. de Sta. Isabel, 52, Centro, Madrid',
    hours: '10:00 – 21:00', status: 'soon', statusLabel: 'Fecha em 1 h', distance: '1,4 km',
    note: '', photo: 'https://images.unsplash.com/photo-1564399579883-451a5d44ec08?auto=format&fit=crop&w=1200&q=85',
    x: 61, y: 72, rating: '4,5',
  },
];

export default function Home() {
  const [places, setPlaces] = useState(initialPlaces);
  const [selectedId, setSelectedId] = useState('prado');
  const [view, setView] = useState<'map' | 'list'>('map');
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [mapsOpen, setMapsOpen] = useState(false);
  const [addPlaceOpen, setAddPlaceOpen] = useState(false);
  const [newMapName, setNewMapName] = useState('');
  const [maps, setMaps] = useState(['Madri']);
  const [currentMap, setCurrentMap] = useState('Madri');
  const [locationLabel, setLocationLabel] = useState('Sua localização');
  const [toast, setToast] = useState('');
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const savedNotes = localStorage.getItem('roamly-notes');
    if (!savedNotes) return;
    try {
      const notes = JSON.parse(savedNotes) as Record<string, string>;
      setPlaces((current) => current.map((place) => ({ ...place, note: notes[place.id] ?? place.note })));
    } catch { /* Keep curated defaults if local data is invalid. */ }
  }, []);

  const visiblePlaces = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return places.filter((place) => {
      const matches = !normalized || `${place.name} ${place.category} ${place.address}`.toLocaleLowerCase('pt-BR').includes(normalized);
      return (place.destination ?? 'Madri') === currentMap && matches && (!onlyOpen || place.status === 'open');
    });
  }, [places, query, onlyOpen, currentMap]);

  const selected = places.find((place) => place.id === selectedId) ?? places[0];

  function saveNote(value: string) {
    const next = places.map((place) => (place.id === selected.id ? { ...place, note: value } : place));
    setPlaces(next);
    localStorage.setItem('roamly-notes', JSON.stringify(Object.fromEntries(next.map((place) => [place.id, place.note]))));
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setToast('Localização não disponível neste dispositivo'); return; }
    setLocationLabel('Localizando…');
    navigator.geolocation.getCurrentPosition(
      () => { setLocationLabel('Localização atualizada agora'); setToast('Você está no centro de Madri'); },
      () => { setLocationLabel('Centro de Madri'); setToast('Usando o centro de Madri como referência'); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function openDirections(mode: 'walking' | 'driving' | 'bicycling' | 'transit') {
    const destination = encodeURIComponent(selected.name);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${destination}&destination_place_id=${selected.placeId}&travelmode=${mode}`, '_blank', 'noopener,noreferrer');
    setRouteOpen(false);
  }

  function createMap() {
    if (!newMapName.trim()) return;
    const mapName = newMapName.trim();
    if (!maps.includes(mapName)) setMaps((current) => [...current, mapName]);
    setCurrentMap(mapName);
    setToast(`Mapa “${mapName}” criado`); setNewMapName(''); setMapsOpen(false);
  }

  function addSuggestedPlace(place: Place) {
    const savedPlace = { ...place, id: `${place.id}-${currentMap}`, destination: currentMap };
    if (!places.some((item) => item.placeId === place.placeId && (item.destination ?? 'Madri') === currentMap)) setPlaces((current) => [...current, savedPlace]);
    setSelectedId(savedPlace.id); setAddPlaceOpen(false);
    setToast(`${place.name} salvo no roteiro`);
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="icon-button menu-button" aria-label="Abrir menu"><Menu size={21} /></button>
        <button className="trip-switcher" onClick={() => setMapsOpen(true)} aria-label="Trocar mapa de viagem">
          <span className="trip-pin"><MapPin size={17} fill="currentColor" /></span>
          <span><small>MEU ROTEIRO</small><strong>{currentMap}</strong></span><ChevronDown size={17} />
        </button>
        <button className="avatar" aria-label="Abrir perfil">AS</button>
      </header>

      <section className="toolbar" aria-label="Ferramentas do mapa">
        <div className="search-wrap">
          <Search size={19} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar no seu roteiro" aria-label="Buscar no seu roteiro" />
          {query && <button onClick={() => setQuery('')} aria-label="Limpar busca"><X size={16} /></button>}
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
            <div><span className="eyebrow">QUARTA, 26 AGO</span><h1>Seu dia em {currentMap}</h1><p>{visiblePlaces.length} lugares · 2,8 km</p></div>
            <button className="small-add" onClick={() => setAddPlaceOpen(true)}><Plus size={19} /></button>
          </div>
          <div className="progress-card"><span><Sparkles size={15} /> Bom momento para explorar</span><p>2 lugares estão abertos e perto de você.</p></div>
          <div className="place-list desktop-list">
            {visiblePlaces.map((place) => <PlaceRow key={place.id} place={place} active={place.id === selected.id} onSelect={() => setSelectedId(place.id)} />)}
          </div>
          <button className="add-place-button" onClick={() => setAddPlaceOpen(true)}><Plus size={18} /> Adicionar lugar</button>
        </aside>

        <div className={`map-area ${view === 'list' ? 'mobile-list-view' : ''}`}>
          <div className="map-canvas" style={{ '--map-scale': zoom } as React.CSSProperties}>
            <div className="map-text label-sol">SOL</div><div className="map-text label-retiro">RETIRO</div>
            <div className="map-text street-one">Calle de Alcalá</div><div className="map-text street-two">Gran Vía</div>
            <div className="park park-one" /><div className="park park-two" /><div className="water" />
            <div className="user-location" aria-label="Sua localização"><span /><i /><em>{locationLabel}</em></div>
            {visiblePlaces.map((place) => (
              <button key={place.id} className={`map-marker ${place.status} ${selected.id === place.id ? 'selected' : ''}`}
                style={{ left: `${place.x}%`, top: `${place.y}%` }} onClick={() => setSelectedId(place.id)}
                aria-label={`${place.name}: ${place.statusLabel}`}>
                <span>{place.category === 'Restaurante' ? 'R' : place.category === 'Parque' ? 'P' : '◆'}</span>
              </button>
            ))}
            {visiblePlaces.length === 0 && <div className="empty-map"><Search size={24} /><strong>Nenhum lugar encontrado</strong><span>Tente buscar outro nome ou remover os filtros.</span></div>}
          </div>
          <div className="map-controls"><button onClick={() => setZoom((value) => Math.min(1.14, value + .04))} aria-label="Aumentar zoom">+</button><button onClick={() => setZoom((value) => Math.max(.9, value - .04))} aria-label="Diminuir zoom">−</button></div>
          <button className="locate-button" onClick={useMyLocation} aria-label="Usar minha localização"><LocateFixed size={21} /></button>

          <div className="mobile-list">
            <div className="mobile-list-heading"><div><span className="eyebrow">QUARTA, 26 AGO</span><h2>Seu dia em {currentMap}</h2></div><span>{visiblePlaces.length} lugares</span></div>
            <div className="place-list">{visiblePlaces.map((place) => <PlaceRow key={place.id} place={place} active={place.id === selected.id} onSelect={() => setSelectedId(place.id)} />)}</div>
          </div>

          {view === 'map' && visiblePlaces.some((place) => place.id === selected.id) && (
            <article className="place-card">
              <button className="close-card" onClick={() => setSelectedId('')} aria-label="Fechar detalhes"><X size={18} /></button>
              <div className="place-photo" style={{ backgroundImage: `linear-gradient(180deg, transparent 45%, rgba(17,25,21,.62)), url('${selected.photo}')` }}>
                <span className={`status-pill ${selected.status}`}><i />{selected.statusLabel}</span><span className="rating"><Star size={13} fill="currentColor" /> {selected.rating}</span>
              </div>
              <div className="place-content">
                <div className="place-title"><div><span>{selected.category}</span><h2>{selected.name}</h2></div><strong>{selected.distance}</strong></div>
                <div className="meta-row"><MapPin size={16} /><span>{selected.address}</span></div>
                <div className="meta-row"><Clock3 size={16} /><span><strong>{selected.statusLabel}</strong> · Hoje, {selected.hours}</span></div>
                <label className="note-field"><span>NOTA PESSOAL</span><input value={selected.note} onChange={(event) => saveNote(event.target.value)} /></label>
                <button className="go-button" onClick={() => setRouteOpen(true)}><Navigation size={19} fill="currentColor" /> Ir</button>
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
              <button onClick={() => openDirections('walking')}><Footprints size={24} /><strong>A pé</strong><span>14 min</span></button>
              <button onClick={() => openDirections('driving')}><Car size={24} /><strong>Carro</strong><span>7 min</span></button>
              <button onClick={() => openDirections('bicycling')}><Bike size={24} /><strong>Bicicleta</strong><span>6 min</span></button>
              <button onClick={() => openDirections('transit')}><BusFront size={24} /><strong>Transporte</strong><span>11 min</span></button>
            </div><p className="google-note">A rota será aberta no Google Maps.</p>
          </section>
        </div>
      )}

      {mapsOpen && (
        <div className="modal-backdrop" onClick={() => setMapsOpen(false)}>
          <section className="maps-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Seus mapas">
            <div className="modal-heading"><div><span>SEUS MAPAS</span><h2>Para onde vamos?</h2></div><button onClick={() => setMapsOpen(false)} aria-label="Fechar"><X size={19} /></button></div>
            {maps.map((mapName, index) => (
              <button key={mapName} className={`map-option ${currentMap === mapName ? 'selected' : ''}`} onClick={() => { setCurrentMap(mapName); setMapsOpen(false); setToast(`Mapa “${mapName}” aberto`); }}>
                <span className={`map-thumb ${index === 0 ? 'madrid' : 'lisbon'}`}>{mapName.slice(0,3).toUpperCase()}</span>
                <span><strong>{mapName}</strong><small>{places.filter((place) => (place.destination ?? 'Madri') === mapName).length ? `${places.filter((place) => (place.destination ?? 'Madri') === mapName).length} lugares salvos` : 'Nenhum lugar salvo'}</small></span>
                {currentMap === mapName && <Check size={19} />}
              </button>
            ))}
            <div className="new-map-form"><label htmlFor="new-map">NOVO DESTINO</label><div><input id="new-map" value={newMapName} onChange={(event) => setNewMapName(event.target.value)} placeholder="Ex.: Roma" onKeyDown={(event) => event.key === 'Enter' && createMap()} /><button onClick={createMap}><Plus size={18} /> Criar mapa</button></div></div>
          </section>
        </div>
      )}
      {addPlaceOpen && (
        <div className="modal-backdrop" onClick={() => setAddPlaceOpen(false)}>
          <section className="maps-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Adicionar lugar">
            <div className="modal-heading"><div><span>GOOGLE PLACES</span><h2>Adicionar ao roteiro</h2></div><button onClick={() => setAddPlaceOpen(false)} aria-label="Fechar"><X size={19} /></button></div>
            <div className="places-search"><Search size={18} /><input placeholder="Buscar por nome ou endereço" autoFocus /></div>
            <p className="source-note">Resultados vinculados ao <code>place_id</code> oficial.</p>
            {suggestedPlaces.map((place) => {
              const saved = places.some((item) => item.placeId === place.placeId && (item.destination ?? 'Madri') === currentMap);
              return <button key={place.placeId} className="suggestion-row" onClick={() => !saved && addSuggestedPlace(place)} disabled={saved}>
                <span className="row-photo" style={{ backgroundImage: `url('${place.photo}')` }} />
                <span><strong>{place.name}</strong><small>{place.address}</small><em>{place.statusLabel}</em></span>
                <span className="suggestion-action">{saved ? <Check size={17} /> : <Plus size={17} />}</span>
              </button>;
            })}
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
      <span className="row-photo" style={{ backgroundImage: `url('${place.photo}')` }}><i className={place.status} /></span>
      <span className="row-copy"><strong>{place.name}</strong><small>{place.category} · {place.distance}</small><em className={place.status}>{place.statusLabel}</em></span>
      <span className={`status-dot ${place.status}`} title={statusCopy[place.status]} />
    </button>
  );
}
