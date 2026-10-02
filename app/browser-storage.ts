const unavailable = (): never => { throw new Error('Browser storage is unavailable'); };
const blocked: Storage = { get length() { return unavailable(); }, key: unavailable, getItem: unavailable, setItem: unavailable, removeItem: unavailable, clear: unavailable };

// Accessing localStorage itself can throw (private/restricted browser contexts).
// Do not pretend a memory-only queue is durable: callers catch method failures
// and keep the visible warning while preserving this session's edits.
export function browserStorage(): Storage {
  try { return globalThis.localStorage ?? blocked; } catch { return blocked; }
}
