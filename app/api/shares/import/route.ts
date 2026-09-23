import { database } from '../../_lib/db';
import { getSessionUser } from '../../_lib/auth';
import { checkAuthMutation, checkExpectedAccount } from '../../_lib/request-security';
import { withoutDistance } from '../../../data-privacy';

export const runtime = 'edge';

type Itinerary = { maps?: unknown; currentMap?: unknown; places?: unknown };
type ShareRecord = { share_id: string; owner_user_id: string; owner_generation: string; map_name: string; invited_email: string };

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' } });
}

function safePlace(value: unknown, mapName: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const place = withoutDistance(value) as Record<string, unknown>;
  if (typeof place.placeId !== 'string' || !place.placeId || typeof place.name !== 'string') return null;
  const fields = ['placeId', 'name', 'category', 'address', 'hours', 'status', 'statusLabel', 'photo', 'x', 'y', 'rating', 'lat', 'lng', 'googleMapsURI', 'photoAttribution', 'pinColor'];
  const copy = Object.fromEntries(fields.filter((field) => place[field] !== undefined).map((field) => [field, place[field]]));
  return { ...copy, id: `${place.placeId}-${mapName}`, destination: mapName, note: '' };
}

export async function POST(request: Request) {
  const denied = await checkAuthMutation(request);
  if (denied) return denied;
  const user = await getSessionUser(request);
  if (!user) return response({ error: 'Entre com o Google para continuar' }, 401);
  const mismatch = checkExpectedAccount(request, user);
  if (mismatch) return mismatch;

  try {
    const body = await request.json() as { shareId?: unknown };
    const shareId = typeof body.shareId === 'string' ? body.shareId.trim() : '';
    if (!/^[0-9a-f-]{36}$/i.test(shareId)) return response({ error: 'Convite inválido ou expirado.' }, 404);

    const db = database();
    const share = await db.prepare('SELECT share_id, owner_user_id, owner_generation, map_name, invited_email FROM map_shares WHERE share_id = ?').bind(shareId).first<ShareRecord>();
    if (!share || share.invited_email !== user.email.trim().toLowerCase()) return response({ error: 'Este roteiro não está disponível para esta conta.' }, 404);
    const owner = await db.prepare('SELECT generation FROM user_accounts WHERE user_id = ?').bind(share.owner_user_id).first<{ generation: string }>();
    if (owner?.generation !== share.owner_generation) return response({ error: 'Este convite não está mais disponível.' }, 404);

    const ownerRow = await db.prepare('SELECT data_json FROM user_itineraries WHERE user_id = ?').bind(share.owner_user_id).first<{ data_json: string }>();
    let source: Itinerary | null = null;
    try { source = ownerRow ? JSON.parse(ownerRow.data_json) as Itinerary : null; } catch { source = null; }
    const ownerMaps = Array.isArray(source?.maps) ? source.maps : [];
    if (!ownerMaps.includes(share.map_name)) return response({ error: 'O roteiro original foi removido.' }, 404);

    const recipientRow = await db.prepare('SELECT data_json FROM user_itineraries WHERE user_id = ?').bind(user.id).first<{ data_json: string }>();
    let current: Itinerary = { maps: [], currentMap: '', places: [] };
    try { if (recipientRow) current = JSON.parse(recipientRow.data_json) as Itinerary; } catch { /* Start with an empty personal itinerary if a prior row is invalid. */ }
    const maps = Array.isArray(current.maps) ? current.maps.filter((item): item is string => typeof item === 'string' && item.length <= 120) : [];
    const places = Array.isArray(current.places) ? current.places.filter((place) => place && typeof place === 'object').map((place) => withoutDistance(place)) : [];
    const mapExists = maps.some((name) => name.localeCompare(share.map_name, undefined, { sensitivity: 'base' }) === 0);
    if (!mapExists && maps.length >= 100) return response({ error: 'Sua conta já atingiu o limite de roteiros.' }, 409);

    const sourcePlaces = Array.isArray(source?.places) ? source.places : [];
    const imported = sourcePlaces
      .filter((place) => place && typeof place === 'object' && ((place as { destination?: unknown }).destination ?? 'Madri') === share.map_name)
      .map((place) => safePlace(place, share.map_name))
      .filter((place): place is NonNullable<typeof place> => Boolean(place));
    const existingKeys = new Set(places.filter((place) => typeof (place as { destination?: unknown }).destination === 'string' && typeof (place as { placeId?: unknown }).placeId === 'string')
      .map((place) => `${(place as { placeId: string }).placeId}:${((place as { destination: string }).destination).toLocaleLowerCase()}`));
    const additions = imported.filter((place) => {
      const key = `${place.placeId}:${share.map_name.toLocaleLowerCase()}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    const nextMaps = mapExists ? maps : [...maps, share.map_name];
    const updatedAt = Date.now();
    const payload = JSON.stringify({ maps: nextMaps, currentMap: share.map_name, places: [...places, ...additions], updatedAt });
    if (payload.length > 900_000) return response({ error: 'Não há espaço suficiente para copiar este roteiro. Libere espaço nos seus roteiros e tente novamente.' }, 413);

    const save = await db.prepare(`
      INSERT INTO user_itineraries (user_id, data_json, updated_at)
      SELECT ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM user_accounts WHERE user_id = ? AND generation = ?)
        AND EXISTS (
          SELECT 1 FROM map_shares s
          JOIN user_accounts owner ON owner.user_id = s.owner_user_id AND owner.generation = s.owner_generation
          WHERE s.share_id = ? AND s.invited_email = ? AND s.owner_generation = ?
        )
      ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `).bind(user.id, payload, updatedAt, user.id, user.generation, shareId, user.email.trim().toLowerCase(), share.owner_generation).run();
    if (!save.meta.changes) return response({ error: 'O convite mudou ou expirou. Peça um novo link.' }, 404);
    return response({ ok: true, mapName: share.map_name, addedCount: additions.length });
  } catch {
    return response({ error: 'Não foi possível salvar o roteiro agora. Tente novamente.' }, 500);
  }
}
