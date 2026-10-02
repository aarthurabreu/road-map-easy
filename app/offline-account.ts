import type { AuthUser } from './trip-guide/types';
export const offlineAccountKey = 'roamly-last-account';
// This is a cache hint for offline display, NEVER proof of authentication.
// Every API write still verifies the signed server session and exact generation.
export function cachedAccount(storage: Pick<Storage, 'getItem'>): AuthUser | null {
  try {
    const user = JSON.parse(storage.getItem(offlineAccountKey) ?? 'null') as AuthUser | null;
    return user && ['id', 'generation', 'email', 'name'].every((field) => typeof user[field as keyof AuthUser] === 'string' && user[field as keyof AuthUser]) ? user : null;
  } catch { return null; }
}
