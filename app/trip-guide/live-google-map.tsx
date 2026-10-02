'use client';

import { useEffect, useRef } from 'react';
import { translations, type Copy, type Language } from '../i18n';
import { createMarkerRegistry } from '../map-markers';
import { getPinColor } from './place-model';
import { localizedStatusLabel } from './google-places';
import type { Place, Theme } from './types';

export function LiveGoogleMap({
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
  const t: Copy = translations[language];
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
    if (!mapRef.current) return;
    if (!userPosition) {
      if (userMarkerRef.current) {
        userMarkerRef.current.map = null;
        userMarkerRef.current = null;
      }
      return;
    }
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
