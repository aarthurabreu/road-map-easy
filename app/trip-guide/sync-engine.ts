import { accountFetch, accountStorage, AccountChangedError } from '../account-storage';
import { cleanItinerary, emptyItinerary, itineraryOperations, reconcileItinerary, type Itinerary, type PendingOperation, type SyncConflict } from '../itinerary-sync';
import { saveCloudState } from './itinerary-persistence';
import { parsePlace } from '../place-schema';

type CloudState = { userId: string; data: Itinerary | null; revision: number; acknowledgedIds?: string[]; invalidCount?: number };
export type SyncResult = { data: Itinerary; conflicts: SyncConflict[]; pending: number; durable: boolean; invalidCount?: number; readOnly?: boolean };
export class ConflictChangedError extends Error {}
export class SyncEngine {
  readonly prefix: string;
  current: Itinerary;
  durable = true;
  private checkpoint: Itinerary | null = null;
  private legacy: Itinerary | null = null;
  private origin: Itinerary;
  private remote = emptyItinerary();
  private observed: PendingOperation[] = [];
  private memory = new Map<string, PendingOperation>();
  private volatile = new Set<string>();
  private lastTime = 0;
  private running: Promise<SyncResult> | null = null;
  private initialized = false;
  private invalidQueue = false;
  private storageUnreadable = false;
  private offerGuestAllowed = false;
  constructor(readonly owner: string, private storage: Storage, initial: Itinerary, private active: () => boolean = () => true) {
    this.prefix = `roamly-cache:user:${encodeURIComponent(owner)}:roamly-pending:`;
    this.current = cleanItinerary(initial);
    this.origin = structuredClone(this.current);
    try {
      const cache = accountStorage(storage, owner);
      this.checkpoint = JSON.parse(cache.getItem('roamly-sync-base') ?? 'null');
      this.offerGuestAllowed = !this.checkpoint && cache.getItem('roamly-maps') === null;
      if (!this.checkpoint) {
        // Keep the pre-queue baseline across an offline reload. Seeding the final
        // edited cache would replay older edits on top of their own result.
        this.origin = cleanItinerary(JSON.parse(cache.getItem('roamly-sync-origin') ?? JSON.stringify(this.current)));
        cache.setItem('roamly-sync-origin', JSON.stringify(this.origin));
        if (cache.getItem('roamly-maps') !== null) this.legacy = structuredClone(this.origin);
      }
      this.pending();
    } catch { this.durable = false; }
  }
  pending() {
    this.invalidQueue = false;
    this.storageUnreadable = false;
    try {
      // Enumeration can work even when reading values is blocked. Do not use
      // that as permission to overwrite a baseline or an inaccessible queue.
      this.storage.getItem(this.prefix + 'read-probe');
      const found = new Set<string>();
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (key?.startsWith(this.prefix)) {
          let operation: PendingOperation;
          try {
            operation = JSON.parse(this.storage.getItem(key) ?? 'null');
            if (!operation || key !== this.prefix + operation.id || !/^[0-9a-f-]{36}$/i.test(operation.id) || !Number.isFinite(operation.createdAt) || !['map', 'place', 'field', 'current'].includes(operation.kind) || typeof operation.map !== 'string' || !('before' in operation) || !('after' in operation)
              || (operation.kind === 'field' && (!operation.key || !['note', 'pinColor'].includes(operation.field ?? '') || !operation.place))
              || (operation.kind === 'place' && !operation.key)) throw new Error('Invalid pending edit');
            if ((operation.kind === 'place' && operation.after !== null && !parsePlace(operation.after, { strict: true }).place)
              || (operation.kind === 'field' && (!parsePlace(operation.place, { strict: true }).place || (operation.after !== null && (typeof operation.after !== 'string' || operation.after.length > (operation.field === 'note' ? 20_000 : 64)))))) throw new Error('Invalid pending place');
          } catch { this.invalidQueue = true; this.durable = false; continue; }
          found.add(operation.id);
          this.memory.set(operation.id, operation);
          this.lastTime = Math.max(this.lastTime, operation.createdAt);
        }
      }
      for (const id of this.memory.keys()) if (!found.has(id) && !this.volatile.has(id)) this.memory.delete(id);
    } catch { this.durable = false; this.invalidQueue = true; this.storageUnreadable = true; }
    return [...this.memory.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  private append(operations: PendingOperation[]) {
    for (const operation of operations) {
      operation.createdAt = Math.max(operation.createdAt, this.lastTime + 1);
      this.lastTime = operation.createdAt;
      this.memory.set(operation.id, operation);
      try { this.storage.setItem(this.prefix + operation.id, JSON.stringify(operation)); this.volatile.delete(operation.id); } catch { this.durable = false; this.volatile.add(operation.id); }
    }
  }
  capture(next: Itinerary) {
    this.append(itineraryOperations(this.current, next));
    this.current = cleanItinerary(next);
  }
  private acknowledge(ids: string[]) {
    for (const id of ids) {
      // Remove only acknowledged IDs, never an entire queue or newer edits.
      try { this.storage.removeItem(this.prefix + id); } catch { this.durable = false; }
      this.memory.delete(id);
      this.volatile.delete(id);
    }
  }
  private saveBase(data: Itinerary) {
    this.checkpoint = cleanItinerary(data);
    try { accountStorage(this.storage, this.owner).setItem('roamly-sync-base', JSON.stringify(this.checkpoint)); } catch { this.durable = false; }
  }
  private persistVolatile() {
    for (const id of this.volatile) {
      try { this.storage.setItem(this.prefix + id, JSON.stringify(this.memory.get(id))); this.volatile.delete(id); }
      catch { this.durable = false; }
    }
  }
  async synchronize(offerGuest?: () => Itinerary | null): Promise<SyncResult> {
    if (this.running) return this.running;
    this.running = this.run(offerGuest).finally(() => { this.running = null; });
    return this.running;
  }
  private async run(offerGuest?: () => Itinerary | null): Promise<SyncResult> {
    let preview = this.current;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!this.active()) throw new AccountChangedError('A conta mudou');
      this.durable = true;
      this.persistVolatile();
      const known = this.pending().slice(0, 100);
      const unreadable = this.storageUnreadable;
      if (this.invalidQueue && !unreadable) throw new Error('Não foi possível ler todas as alterações deste aparelho. Baixe seus dados antes de continuar.');
      const query = new URLSearchParams(known.map((operation) => ['pending', operation.id]));
      const response = await accountFetch(this.owner, '/api/sync' + (query.size ? '?' + query : ''));
      if (!response.ok) throw new Error('Não foi possível carregar seus roteiros');
      const cloud = await response.json() as CloudState;
      if (!this.active() || cloud.userId !== this.owner) throw new AccountChangedError('A conta mudou');
      if (!Number.isSafeInteger(cloud.revision) || cloud.revision < 0) throw new Error('Atualize o aplicativo para sincronizar');
      if (unreadable) {
        // Unknown durable edits might exist. Read the cloud and retain volatile
        // intent, but do not acknowledge, overwrite caches, or PUT anything.
        this.remote = cleanItinerary(cloud.data ?? emptyItinerary());
        this.current = reconcileItinerary(this.remote, known, true).data;
        return { data: this.current, conflicts: [], pending: known.length, durable: false, readOnly: true, invalidCount: cloud.invalidCount };
      }
      this.acknowledge((cloud.acknowledgedIds ?? []).filter((id) => known.some((operation) => operation.id === id)));
      const remote = cleanItinerary(cloud.data ?? emptyItinerary());
      if (!this.initialized) {
        if (!cloud.data) {
          const initial = this.origin.maps.length ? this.origin : (this.offerGuestAllowed && !this.pending().length ? offerGuest?.() : null) ?? emptyItinerary();
          {
            const time = this.lastTime; this.lastTime = -1;
            const operations = itineraryOperations(emptyItinerary(), initial).map((operation) => ({ ...operation, createdAt: 0 }));
            this.append(operations); this.lastTime = Math.max(time, this.lastTime);
          }
        } else if (this.legacy) {
          const recovered = itineraryOperations(remote, this.legacy);
          for (const operation of recovered) {
            if (operation.before !== null && operation.kind !== 'current') operation.before = { unknownLegacyBase: true };
            operation.createdAt = 0;
          }
          // Legacy edits precede new operations recorded in this session.
          const time = this.lastTime; this.lastTime = 0; this.append(recovered); this.lastTime = Math.max(time, this.lastTime);
        }
        this.initialized = true;
      }
      this.remote = remote;
      this.saveBase(remote);
      const pending = this.pending();
      const merged = reconcileItinerary(remote, pending);
      this.observed = pending;
      preview = merged.conflicts.length ? reconcileItinerary(remote, pending, true).data : merged.data;
      if (merged.conflicts.length || !pending.length) {
        this.current = preview;
        return { data: preview, conflicts: merged.conflicts, pending: pending.length, durable: this.durable, invalidCount: cloud.invalidCount };
      }
      const batch = pending.slice(0, 100);
      const data = reconcileItinerary(remote, batch).data;
      if (!this.active()) throw new AccountChangedError('A conta mudou');
      const save = await saveCloudState(this.owner, data.maps, data.currentMap, data.places, cloud.revision, batch.map((operation) => operation.id));
      if (!this.active()) throw new AccountChangedError('A conta mudou');
      if (save.status === 412) continue; // Fetch, rebase, then retry; never overwrite.
      if (!save.ok) throw new Error('Não foi possível sincronizar seus roteiros');
      const result = await save.json() as { acknowledgedIds?: string[] };
      if (!result.acknowledgedIds || !batch.every((operation) => result.acknowledgedIds!.includes(operation.id))) throw new Error('Confirmação de sincronização inválida');
      // The last loop iteration may end immediately after a successful PUT.
      // Keep its acknowledged snapshot, not the preceding GET's older version.
      this.remote = data;
      this.saveBase(data);
      this.acknowledge(batch.map((operation) => operation.id));
    }
    this.current = reconcileItinerary(this.remote, this.pending(), true).data;
    return { data: this.current, conflicts: [], pending: this.pending().length, durable: this.durable };
  }
  resolve(choice: 'local' | 'cloud') {
    if (this.running) throw new Error('Aguarde a sincronização');
    const conflicts = reconcileItinerary(this.remote, this.observed).conflicts.map((item) => item.operation);
    const original = this.pending();
    if (conflicts.some((operation) => !original.some((item) => item.id === operation.id))) throw new ConflictChangedError('Este conflito mudou em outra aba');
    if (choice === 'local') {
      // Resolve the final local intent, not an intermediate conflicting edit
      // from a chain A→B→C. Preserve unrelated and newly captured edits too.
      const chosen = reconcileItinerary(this.remote, original, true).data;
      this.append(itineraryOperations(this.remote, chosen));
      if (this.volatile.size) throw new Error('Não foi possível guardar a escolha neste aparelho. Mantenha o app aberto e tente novamente.');
      this.acknowledge(original.map((operation) => operation.id));
    } else {
      this.acknowledge(conflicts.map((operation) => operation.id));
    }
    this.current = reconcileItinerary(this.remote, this.pending(), true).data;
  }
}
