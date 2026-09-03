export type MapPlacePin = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  color: string;
  glyph: string;
  selected: boolean;
};

type Entry = {
  marker: google.maps.marker.AdvancedMarkerElement;
  pin: google.maps.marker.PinElement;
  value: MapPlacePin;
  dispose: () => void;
};

// GPS, notes, sorting and selection must never detach an existing marker.
export function createMarkerRegistry(map: google.maps.Map, onSelect: (id: string) => void) {
  const entries = new Map<string, Entry>();
  return {
    update(places: MapPlacePin[]) {
      const remaining = new Set(places.map((place) => place.id));
      for (const [id, entry] of entries) {
        if (!remaining.has(id)) { entry.dispose(); entries.delete(id); }
      }
      for (const place of places) {
        const entry = entries.get(place.id);
        if (!entry) {
          const pin = new google.maps.marker.PinElement({
            background: place.color, borderColor: '#ffffff', glyphColor: '#ffffff',
            glyphText: place.glyph, scale: place.selected ? 1.28 : 1.05,
          });
          const marker = new google.maps.marker.AdvancedMarkerElement({
            map, position: { lat: place.lat, lng: place.lng }, title: place.title,
            content: pin, gmpClickable: true, zIndex: place.selected ? 20 : 10,
          });
          const handleClick = () => onSelect(place.id);
          marker.addEventListener('gmp-click', handleClick);
          entries.set(place.id, { marker, pin, value: place, dispose: () => {
            marker.removeEventListener('gmp-click', handleClick);
            marker.map = null;
          } });
          continue;
        }
        const previous = entry.value;
        if (previous.lat !== place.lat || previous.lng !== place.lng) entry.marker.position = { lat: place.lat, lng: place.lng };
        if (previous.title !== place.title) entry.marker.title = place.title;
        if (previous.color !== place.color) entry.pin.background = place.color;
        if (previous.glyph !== place.glyph) entry.pin.glyphText = place.glyph;
        if (previous.selected !== place.selected) {
          entry.pin.scale = place.selected ? 1.28 : 1.05;
          entry.marker.zIndex = place.selected ? 20 : 10;
        }
        entry.value = place;
      }
    },
    clear() {
      for (const entry of entries.values()) entry.dispose();
      entries.clear();
    },
  };
}
