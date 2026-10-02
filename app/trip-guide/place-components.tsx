'use client';

/* Official Google photo URLs require a normal img, and photo failure resets when its source changes. */
/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import { Map as MapIcon, MapPin, Navigation } from 'lucide-react';
import { translations, type Copy, type Language } from '../i18n';
import { localizedCategory, localizedStatusLabel } from './google-places';
import type { Place, MapsStatus } from './types';

export function PlacePhoto({ place, language, className = '', lazy = false }: { place: Place; language: Language; className?: string; lazy?: boolean }) {
  const [failedSource, setFailedSource] = useState('');
  if (!place.photo || failedSource === place.photo) return null;
  return <img className={className} src={place.photo} alt={`${translations[language].photoOf} ${place.name}`} loading={lazy ? 'lazy' : undefined} onError={() => setFailedSource(place.photo)} />;
}

export function PhotoCredits({ place, language, className = 'photo-credit' }: { place: Place; language: Language; className?: string }) {
  const authors = place.photoAttributions?.length ? place.photoAttributions : place.photoAttribution ? [place.photoAttribution] : [];
  if (!place.photo || !authors.length) return null;
  return <span className={className}>{translations[language].photo}: {authors.map((author, index) => <span key={author.url + index}>{index > 0 && ', '}{author.url ? <a href={author.url} target="_blank" rel="noopener noreferrer">{author.name}</a> : author.name}</span>)}</span>;
}

export function PlaceRow({ place, active, language, onSelect }: { place: Place; active: boolean; language: Language; onSelect: () => void }) {
  const t: Copy = translations[language];
  return (
    <div className="place-row-container">
      <button className={`place-row ${active ? 'active' : ''}`} onClick={onSelect}>
        <span className="row-photo"><MapPin size={19} /><PlacePhoto place={place} language={language} lazy /><i className={place.status} /></span>
        <span className="row-copy">
          <strong>{place.name}</strong><small>{localizedCategory(place.category, language)}</small>
          <span className={`row-distance ${place.distance === '—' ? 'pending' : ''}`}><Navigation size={11} />{place.distance === '—' ? t.distancePending : place.distance}</span>
          <em className={place.status}>{localizedStatusLabel(place.statusLabel, language)}</em>
        </span>
        <span className={`status-dot ${place.status}`} title={localizedStatusLabel(place.statusLabel, language)} />
      </button>
      <PhotoCredits place={place} language={language} className="row-photo-credit" />
    </div>
  );
}

export function MapsConnection({ status, error, onConnect, onRetry, language }: { status: MapsStatus; error: string; onConnect: (key: string) => void; onRetry: () => void; language: Language }) {
  const [key, setKey] = useState('');
  const t: Copy = translations[language];
  if (status === 'offline') return <div className="maps-connect-card compact" role="status"><strong>{language === 'es' ? 'Sin conexión' : language === 'en' ? 'Offline' : 'Sem conexão'}</strong><p>{language === 'es' ? 'Consulta tus lugares guardados. El mapa y los horarios se actualizarán al volver a conectarte.' : language === 'en' ? 'View your saved places. The map and hours will update when you reconnect.' : 'Consulte seus locais salvos. O mapa e os horários serão atualizados quando a conexão voltar.'}</p></div>;
  if (status === 'loading') return <div className="maps-connect-card compact"><span className="search-spinner" /><strong>{t.mapsLoading}</strong></div>;
  return (
    <div className="maps-connect-card">
      <span className="google-badge"><MapIcon size={23} /></span>
      <div><small>{t.liveMap}</small><h2>{t.connectMaps}</h2><p>{t.mapsKeyHelp}</p></div>
      {error && <p className="maps-error">{error}</p>}
      {status === 'error' && <button className="maps-retry" onClick={onRetry}>{language === 'es' ? 'Reintentar' : language === 'en' ? 'Try again' : 'Tentar novamente'}</button>}
      <div className="key-form"><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={t.pasteMapsKey} aria-label={t.mapsKey} onKeyDown={(event) => event.key === 'Enter' && onConnect(key)} /><button onClick={() => onConnect(key)}>{t.connect}</button></div>
      <span className="key-note">{t.mapsKeyNote}</span>
    </div>
  );
}
