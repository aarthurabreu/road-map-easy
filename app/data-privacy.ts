export type AccountIdentity = { id: string; generation: string };

// A new account generation must never reuse a deleted account's browser cache.
export function accountIdentity(user: AccountIdentity) {
  return `${user.id}:${user.generation}`;
}

export function withoutDistance<T>(place: T): T extends object ? Omit<T, 'distance'> : T {
  if (!place || typeof place !== 'object' || Array.isArray(place)) return place as never;
  const copy = { ...place } as Record<string, unknown>;
  delete copy.distance;
  delete copy.openingSchedule;
  // Google photo URIs expire and must be obtained fresh, not saved in backups,
  // browser queues or cloud records. The Place ID remains the durable reference.
  if (copy.photoSource === 'google') { copy.photo = ''; delete copy.photoAttribution; delete copy.photoAttributions; }
  delete copy.photoSource;
  return copy as never;
}

const itineraryKeys = ['roamly-maps', 'roamly-current-map', 'roamly-place-refs', 'roamly-notes', 'roamly-removed-place-keys'];

export function clearItineraryCache(storage: Storage, userId: string | null) {
  const prefixes = userId === null
    ? ['roamly-cache:guest:']
    : [`roamly-cache:user:${encodeURIComponent(userId)}:`, `roamly-cache:user:${encodeURIComponent(userId + ':')}`];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key !== null);
  for (const key of keys) {
    if (prefixes.some((prefix) => key.startsWith(prefix)) || (userId === null && itineraryKeys.includes(key))) storage.removeItem(key);
  }
}

export function clearOtherAccountGenerations(storage: Storage, user: AccountIdentity) {
  const current = `roamly-cache:user:${encodeURIComponent(accountIdentity(user))}:`;
  const legacy = `roamly-cache:user:${encodeURIComponent(user.id)}:`;
  const generationPrefix = `roamly-cache:user:${encodeURIComponent(user.id + ':')}`;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key !== null);
  for (const key of keys) {
    if ((key.startsWith(legacy) || key.startsWith(generationPrefix)) && !key.startsWith(current)) storage.removeItem(key);
  }
}
