import { database } from '../_lib/db';
import { clearBrowserChallenge, clearSessionCookie, getSessionUser } from '../_lib/auth';
import { checkAuthMutation, checkExpectedAccount, checkMutation } from '../_lib/request-security';
import { accountIdentity, withoutDistance } from '../../data-privacy';
import { readItinerary, commitItinerary } from '../_lib/itinerary-revisions';
import { parsePlace } from '../../place-schema';

export const runtime = 'edge';

type CloudItinerary = {
  maps: string[];
  currentMap: string;
  places: unknown[];
  updatedAt: number;
  baseRevision: number;
  mutationIds: string[];
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
    const pendingIds = new URL(request.url).searchParams.getAll('pending');
    if (pendingIds.length > 100 || pendingIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return Response.json({ error: 'Fila inválida' }, { status: 400 });
    return Response.json({ userId: accountIdentity(user), ...await readItinerary(user, pendingIds) }, {
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
    if (!Number.isSafeInteger(data.baseRevision) || data.baseRevision < 0 || data.baseRevision >= Number.MAX_SAFE_INTEGER) {
      return Response.json({ error: 'Atualize o aplicativo para sincronizar sem sobrescrever alterações.', code: 'revision_required' }, { status: 428, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!Array.isArray(data.mutationIds) || !data.mutationIds.length || data.mutationIds.length > 100 || new Set(data.mutationIds).size !== data.mutationIds.length || data.mutationIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) return Response.json({ error: 'Fila inválida' }, { status: 400 });
    if (!Array.isArray(data.maps) || data.maps.length > 100 || data.maps.some((map) => typeof map !== 'string' || map.trim().length > 120) || !Array.isArray(data.places) || typeof data.currentMap !== 'string') {
      return Response.json({ error: 'Dados do roteiro inválidos' }, { status: 400 });
    }
    const parsed = data.places.map((place) => parsePlace(place, { strict: true }));
    if (parsed.some((item) => !item.place) || new Set(parsed.map((item) => item.place?.id)).size !== parsed.length) return Response.json({ error: 'Um local contém dados inválidos. Revise o roteiro antes de salvar.', code: 'invalid_place' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
    data.places = parsed.map((item) => withoutDistance(item.place!));
    const payload = JSON.stringify({ maps: data.maps, currentMap: data.currentMap, places: data.places, updatedAt: Date.now() });
    if (payload.length > 900_000) return Response.json({ error: 'Roteiro grande demais para sincronizar' }, { status: 413 });

    const result = await commitItinerary(user, data, data.baseRevision, data.mutationIds);
    if (!result.saved) {
      if (!await getSessionUser(request)) return unauthorized();
      return Response.json({ code: 'revision_conflict', userId: accountIdentity(user), ...await readItinerary(user, data.mutationIds) }, { status: 412, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: true, ...result, acknowledgedIds: data.mutationIds }, { headers: { 'Cache-Control': 'no-store' } });
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
      db.prepare('DELETE FROM itinerary_mutations WHERE user_id = ? AND generation = ?').bind(user.id, user.generation),
      db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND generation = ?').bind(user.id, user.generation),
      db.prepare('DELETE FROM map_shares WHERE owner_user_id = ? AND owner_generation = ?').bind(user.id, user.generation),
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
