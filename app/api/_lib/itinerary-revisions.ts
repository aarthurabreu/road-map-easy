import { database } from './db';
import type { SessionUser } from './auth';
import { withoutDistance } from '../../data-privacy';
import { readSafeItinerary } from '../../place-schema';

export async function readItinerary(user: SessionUser, pendingIds: string[] = []) {
  const db = database();
  // Read data and receipts from one snapshot, even if a save happens during GET.
  const receipts = pendingIds.length ? '(SELECT json_group_array(mutation_id) FROM itinerary_mutations WHERE user_id = ? AND generation = ? AND mutation_id IN (SELECT value FROM json_each(?)))' : "'[]'";
  const row = await db.prepare(`SELECT i.data_json, i.updated_at, i.revision, ${receipts} AS acknowledgments
    FROM (SELECT 1) anchor LEFT JOIN user_itineraries i ON i.user_id = ? AND EXISTS (SELECT 1 FROM user_accounts a WHERE a.user_id = i.user_id AND a.generation = ?)`)
    .bind(...(pendingIds.length ? [user.id, user.generation, JSON.stringify(pendingIds)] : []), user.id, user.generation)
    .first<{ data_json: string | null; updated_at: number | null; revision: number | null; acknowledgments: string }>();
  let raw: unknown = null;
  try { raw = row?.data_json ? JSON.parse(row.data_json) : null; } catch { raw = {}; }
  const safe = readSafeItinerary(raw);
  const data = raw === null ? null : { ...safe.data, places: safe.data.places.map(withoutDistance) };
  const acknowledgedIds = JSON.parse(row?.acknowledgments ?? '[]') as string[];
  return { data, invalidCount: safe.invalidCount, revision: row?.revision ?? 0, updatedAt: row?.updated_at ?? null, acknowledgedIds };
}

export async function commitItinerary(user: SessionUser, data: { maps: string[]; currentMap: string; places: unknown[] }, baseRevision: number, mutationIds: string[], authorization?: { shareId: string; ownerGeneration: string; email: string }) {
  const db = database();
  const updatedAt = Date.now();
  const writeId = crypto.randomUUID();
  const payload = JSON.stringify({ maps: data.maps, currentMap: data.currentMap, places: data.places.map(withoutDistance), updatedAt });
  if (payload.length > 900_000) throw new Error('Roteiro grande demais para sincronizar');
  const receipt = mutationIds.length ? 'AND NOT EXISTS (SELECT 1 FROM itinerary_mutations WHERE user_id = ? AND generation = ? AND mutation_id IN (SELECT value FROM json_each(?)))' : '';
  const permission = authorization ? `AND EXISTS (SELECT 1 FROM map_shares s JOIN user_accounts owner ON owner.user_id = s.owner_user_id AND owner.generation = s.owner_generation WHERE s.share_id = ? AND s.invited_email = ? AND s.owner_generation = ?)` : '';
  const statements = [db.prepare(`
    INSERT INTO user_itineraries (user_id, data_json, updated_at, revision, write_id)
    SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM user_accounts WHERE user_id = ? AND generation = ?)
      AND ((? = 0 AND NOT EXISTS (SELECT 1 FROM user_itineraries WHERE user_id = ?)) OR EXISTS (SELECT 1 FROM user_itineraries WHERE user_id = ? AND revision = ?))
      ${receipt} ${permission}
    ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at, revision = excluded.revision, write_id = excluded.write_id
    WHERE user_itineraries.revision = ?
  `).bind(user.id, payload, updatedAt, baseRevision + 1, writeId, user.id, user.generation, baseRevision, user.id, user.id, baseRevision,
    ...(mutationIds.length ? [user.id, user.generation, JSON.stringify(mutationIds)] : []), ...(authorization ? [authorization.shareId, authorization.email, authorization.ownerGeneration] : []), baseRevision)];
  // This server-generated token guards every side effect in the atomic batch.
  statements.push(db.prepare('DELETE FROM map_shares WHERE owner_user_id = ? AND owner_generation = ? AND EXISTS (SELECT 1 FROM user_itineraries WHERE user_id = ? AND write_id = ?) AND map_name NOT IN (SELECT value FROM json_each(?))')
    .bind(user.id, user.generation, user.id, writeId, JSON.stringify(data.maps)));
  // Set-based receipts keep a 100-edit batch below D1's query/binding limits.
  if (mutationIds.length) statements.push(db.prepare(`
    INSERT OR IGNORE INTO itinerary_mutations (user_id, generation, mutation_id, revision)
    SELECT ?, ?, value, ? FROM json_each(?) WHERE EXISTS (SELECT 1 FROM user_itineraries WHERE user_id = ? AND write_id = ?)
      AND EXISTS (SELECT 1 FROM user_accounts WHERE user_id = ? AND generation = ?)
  `).bind(user.id, user.generation, baseRevision + 1, JSON.stringify(mutationIds), user.id, writeId, user.id, user.generation));
  const [saved] = await db.batch(statements);
  return { saved: !!saved.meta.changes, updatedAt, revision: baseRevision + 1 };
}
