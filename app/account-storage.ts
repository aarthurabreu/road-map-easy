export type ItineraryStorage = Pick<Storage, 'getItem' | 'setItem'>;

// Legacy keys have no reliable owner. Keep them local to the guest workspace;
// signing in must never silently claim them for the newly authenticated account.
export function accountStorage(storage: ItineraryStorage, owner: string | null): ItineraryStorage {
  const prefix = owner === null ? 'roamly-cache:guest:' : `roamly-cache:user:${encodeURIComponent(owner)}:`;
  return {
    getItem(key) {
      const value = storage.getItem(prefix + key);
      return value === null && owner === null ? storage.getItem(key) : value;
    },
    setItem(key, value) { storage.setItem(prefix + key, value); },
  };
}

export class AccountChangedError extends Error {}

export async function accountFetch(owner: string, input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('X-Roamly-Account', owner);
  const response = await fetch(input, { ...init, headers, cache: 'no-store' });
  if (response.status === 401 || response.status === 409) throw new AccountChangedError('A conta mudou');
  return response;
}

export async function authChallenge() {
  const response = await fetch('/api/auth/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' });
  if (!response.ok) throw new Error('Não foi possível iniciar a autenticação. Tente novamente.');
  const payload = await response.json() as { token?: string };
  if (!payload.token) throw new Error('Desafio de autenticação inválido');
  return payload.token;
}

export const accountChangeKey = 'roamly-account-change';

export function announceAccountChange(deletedUserId?: string) {
  const message = { nonce: crypto.randomUUID(), ...(deletedUserId ? { deletedUserId } : {}) };
  try { localStorage.removeItem('roamly-last-account'); localStorage.setItem(accountChangeKey, JSON.stringify(message)); } catch { /* Server guards still enforce account isolation. */ }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(accountChangeKey);
      try { channel.postMessage(message); } finally { channel.close(); }
    }
  } catch { /* Browser restrictions must not undo a server-confirmed logout/deletion. */ }
}
