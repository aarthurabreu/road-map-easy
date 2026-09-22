import { database } from '../_lib/db';
import { clearBrowserChallenge, clearSessionCookie, getSessionUser } from '../_lib/auth';
import { checkAuthMutation, checkExpectedAccount, checkMutation } from '../_lib/request-security';
import { accountIdentity, withoutDistance } from '../../data-privacy';

export const runtime = 'edge';

type CloudItinerary = {
  maps: string[];
  currentMap: string;
  places: unknown[];
  updatedAt: number;
};

function unauthorized() {
  return Response.json({ error: 'Entre com o Google para sincronizar' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return unauthorized();
  const mismatch = checkExpectedAccount(request, user);
  if (mismatch) return mismatch;
  try {
    const db = database();
    const row = await db.prepare('SELECT data_json, updated_at FROM user_itineraries WHERE user_id = ?').bind(user.id).first<{ data_json: string; updated_at: number }>();
    const data = row ? JSON.parse(row.data_json) : null;
    if (data?.places) data.places = data.places.map(withoutDistance);
    return Response.json({ userId: accountIdentity(user), data, updatedAt: row?.updated_at ?? null }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Não foi possível carregar seus roteiros' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = checkMutation(request);
  if (denied) return denied;
  const user = await getSessionUser(request);
  if (!user) return unauthorized();
  const mismatch = checkExpectedAccount(request, user);
  if (mismatch) return mismatch;
  try {
    const data = await request.json() as CloudItinerary;
    if (!Array.isArray(data.maps) || !Array.isArray(data.places) || typeof data.currentMap !== 'string') {
      return Response.json({ error: 'Dados do roteiro inválidos' }, { status: 400 });
    }
    const payload = JSON.stringify({ maps: data.maps, currentMap: data.currentMap, places: data.places.map(withoutDistance), updatedAt: Date.now() });
    if (payload.length > 900_000) return Response.json({ error: 'Roteiro grande demais para sincronizar' }, { status: 413 });

    const db = database();
    const updatedAt = Date.now();
    const saved = await db.prepare(`
      INSERT INTO user_itineraries (user_id, data_json, updated_at)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM user_accounts WHERE user_id = ? AND generation = ?)
      ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `).bind(user.id, payload, updatedAt, user.id, user.generation).run();
    if (!saved.meta.changes) return unauthorized();
    return Response.json({ ok: true, updatedAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Não foi possível salvar seus roteiros' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const denied = await checkAuthMutation(request);
  if (denied) return denied;
  const user = await getSessionUser(request);
  if (!user) return unauthorized();
  const mismatch = checkExpectedAccount(request, user);
  if (mismatch) return mismatch;
  try {
    const db = database();
    // Atomic deletion plus generation-guarded writes prevent an in-flight save
    // or another device from restoring a deleted account's data.
    await db.batch([
      db.prepare('DELETE FROM user_itineraries WHERE user_id = ? AND EXISTS (SELECT 1 FROM user_accounts WHERE user_id = ? AND generation = ?)').bind(user.id, user.id, user.generation),
      db.prepare('DELETE FROM user_accounts WHERE user_id = ? AND generation = ?').bind(user.id, user.generation),
    ]);
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', clearSessionCookie(request));
    headers.append('Set-Cookie', clearBrowserChallenge(request));
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ error: 'Não foi possível excluir os dados. Tente novamente.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
