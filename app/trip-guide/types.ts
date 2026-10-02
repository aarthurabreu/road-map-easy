
export type Theme = 'light' | 'dark';

export type PlaceStatus = 'open' | 'soon' | 'closed';

export type Place = {
  id: string; placeId: string; name: string; category: string; address: string;
  hours: string; status: PlaceStatus; statusLabel: string; distance: string;
  note: string; photo: string; x: number; y: number; rating: string; destination?: string;
  lat?: number; lng?: number; googleMapsURI?: string; photoAttribution?: { name: string; url: string };
  pinColor?: string;
  photoAttributions?: { name: string; url: string }[];
  photoSource?: 'google';
  openingSchedule?: { utcOffsetMinutes: number; periods: { start: number; end: number; alwaysOpen?: boolean }[]; fetchedAt: number; businessStatus?: string };
};

export type StoredPlaceRef = Partial<Place> & Pick<Place, 'id' | 'placeId'> & { destination: string };

export type MapsStatus = 'loading' | 'ready' | 'needs-key' | 'error' | 'offline';

export type AuthUser = { id: string; email: string; name: string; picture?: string; generation: string };

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'pending' | 'offline' | 'conflict';

export type GoogleIdentityApi = {
  initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void; auto_select?: boolean }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
};

export type SearchPrediction = {
  placeId: string;
  mainText: string;
  secondaryText: string;
  distanceMeters?: number | null;
  modern?: google.maps.places.PlacePrediction;
};

export type TravelMode = 'walking' | 'driving' | 'bicycling' | 'transit';
