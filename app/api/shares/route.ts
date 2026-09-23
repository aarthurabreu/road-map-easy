import { database } from '../_lib/db';
import { getSessionUser } from '../_lib/auth';
import { checkAuthMutation, checkExpectedAccount } from '../_lib/request-security';
import { withoutDistance } from '../../data-privacy';

export const runtime = 'edge';

type Itinerary = { maps?: unknown; places?: unknown };
type ShareRecord = { share_id: string; owner_user_id: string; owner_generation: string; map_name: string; invited_email: string; created_at: number };

function unauthorized() {
  return Response.json({ error: 'Entre com o Google para continuar' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
}

function privateResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' } });
}

function sanitizedPlace(value: unknown) {
  const place = withoutDistance(value) as Record<string, unknown>;
  const fields = ['id', 'placeId', 'name', 'category', 'address', 'hours', 'status', 'statusLabel', 'photo', 'x', 'y', 'rating', 'destination', 'lat', 'lng', 'googleMapsURI', 'photoAttribution', 'pinColor'];
  return Object.fromEntries(fields.filter((field) => place[field] !== undefined).map((field) => [field, place[field]]));
}

async function loadOwnerItinerary(userId: string) {
  const row = await database().prepare('SELECT data_json FROM user_itineraries WHERE user_id = ?').bind(userId).first<{ data_json: string }>();
  if (!row) return null;
  try { return JSON.parse(row.data_json) as Itinerary; } catch { return null; }
}

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  const shareId = url.searchParams.get('shareId')?.trim();
  try {
    if (shareId) {
      if (!/^[0-9a-f-]{36}$/i.test(shareId)) return privateResponse({ error: 'Este convite não está disponível.' }, 404);
      const share = await database().prepare('SELECT share_id, owner_user_id, owner_generation, map_name, invited_email, created_at FROM map_shares WHERE share_id = ?').bind(shareId).first<ShareRecord>();
      if (!share || share.invited_email !== user.email.trim().toLowerCase()) return privateResponse({ error: 'Este convite não está disponível para esta conta.' }, 404);
      const currentOwner = await database().prepare('SELECT generation FROM user_accounts WHERE user_id = ?').bind(share.owner_user_id).first<{ generation: string }>();
      if (currentOwner?.generation !== share.owner_generation) return privateResponse({ error: 'Este convite não está disponível.' }, 404);
      const itinerary = await loadOwnerItinerary(share.owner_user_id);
      const maps = Array.isArray(itinerary?.maps) ? itinerary.maps.filter((map): map is string => typeof map === 'string') : [];
      if (!maps.includes(share.map_name)) return privateResponse({ error: 'Este mapa foi removido ou o convite foi revogado.' }, 404);
      const rawPlaces = Array.isArray(itinerary?.places) ? itinerary.places : [];
      const places = rawPlaces.filter((place) => place && typeof place === 'object' && ((place as { destination?: unknown }).destination ?? 'Madri') === share.map_name).map(sanitizedPlace);
      return privateResponse({ map: { name: share.map_name, places } });
    }

    const mismatch = checkExpectedAccount(request, user);
    if (mismatch) return mismatch;
    const mapName = url.searchParams.get('mapName')?.trim();
    if (mapName && mapName.length > 120) return privateResponse({ error: 'Mapa inválido.' }, 400);
    const rows = mapName
      ? await database().prepare('SELECT share_id, map_name, invited_email, created_at FROM map_shares WHERE owner_user_id = ? AND owner_generation = ? AND map_name = ? ORDER BY created_at DESC').bind(user.id, user.generation, mapName).all<Omit<ShareRecord, 'owner_user_id' | 'owner_generation'>>()
      : await database().prepare('SELECT share_id, map_name, invited_email, created_at FROM map_shares WHERE owner_user_id = ? AND owner_generation = ? ORDER BY created_at DESC').bind(user.id, user.generation).all<Omit<ShareRecord, 'owner_user_id' | 'owner_generation'>>();
    return privateResponse({ shares: rows.results ?? [] });
  } catch {
    return privateResponse({ error: 'Não foi possível carregar os convites agora.' }, 500);
  }
}

export async function POST(request: Request) {
  const denied = await checkAuthMutation(request);
  if (denied) return denied;
  const user = await getSessionUser(request);
  if (!user) return unauthorized();
  const mismatch = checkExpectedAccount(request, user);
  if (mismatch) return mismatch;
  try {
    const body = await request.json() as { mapName?: unknown; email?: unknown };
    const mapName = typeof body.mapName === 'string' ? body.mapName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!mapName || mapName.length > 120 || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return privateResponse({ error: 'Informe um mapa e um e-mail válido.' }, 400);
    }
    if (email === user.email.trim().toLowerCase()) return privateResponse({ error: 'Use o e-mail de outra pessoa para compartilhar.' }, 400);
    const itinerary = await loadOwnerItinerary(user.id);
    const maps = Array.isArray(itinerary?.maps) ? itinerary.maps.filter((map): map is string => typeof map === 'string') : [];
    if (!maps.includes(mapName)) return privateResponse({ error: 'Este mapa não está salvo na sua conta.' }, 404);
    const db = database();
    const count = await db.prepare('SELECT COUNT(*) AS total FROM map_shares WHERE owner_user_id = ? AND owner_generation = ? AND map_name = ?').bind(user.id, user.generation, mapName).first<{ total: number }>();
    const existing = await db.prepare('SELECT share_id FROM map_shares WHERE owner_user_id = ? AND owner_generation = ? AND map_name = ? AND invited_email = ?').bind(user.id, user.generation, mapName, email).first<{ share_id: string }>();
    if (existing) return privateResponse({ shareId: existing.share_id, email, mapName, created: false });
    if ((count?.total ?? 0) >= 50) return privateResponse({ error: 'Este mapa já atingiu o limite de 50 convites.' }, 429);
    const shareId = crypto.randomUUID();
    await db.prepare('INSERT INTO map_shares (share_id, owner_user_id, owner_generation, map_name, invited_email, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM user_accounts WHERE user_id = ? AND generation = ?)').bind(shareId, user.id, user.generation, mapName, email, Date.now(), user.id, user.generation).run();
    const created = await db.prepare('SELECT share_id FROM map_shares WHERE owner_user_id = ? AND owner_generation = ? AND map_name = ? AND invited_email = ?').bind(user.id, user.generation, mapName, email).first<{ share_id: string }>();
    if (!created) return unauthorized();
    return privateResponse({ shareId: created.share_id, email, mapName, created: true }, 201);
  } catch {
    return privateResponse({ error: 'Não foi possível criar o convite. Tente novamente.' }, 500);
  }
}

export async function DELETE(request: Request) {
  const denied = await checkAuthMutation(request);
  if (denied) return denied;
  const user = await getSessionUser(request);
  if (!user) return unauthorized();
  const mismatch = checkExpectedAccount(request, user);
  if (mismatch) return mismatch;
  const shareId = new URL(request.url).searchParams.get('shareId')?.trim() ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(shareId)) return privateResponse({ error: 'Convite inválido.' }, 400);
  try {
    await database().prepare('DELETE FROM map_shares WHERE share_id = ? AND owner_user_id = ? AND owner_generation = ?').bind(shareId, user.id, user.generation).run();
    return privateResponse({ ok: true });
  } catch {
    return privateResponse({ error: 'Não foi possível revogar o convite agora.' }, 500);
  }
}
