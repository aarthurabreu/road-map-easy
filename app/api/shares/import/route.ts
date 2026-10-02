import { database } from '../../_lib/db';
import { readItinerary, commitItinerary } from '../../_lib/itinerary-revisions';
import { getSessionUser } from '../../_lib/auth';
import { checkAuthMutation, checkExpectedAccount } from '../../_lib/request-security';
import { withoutDistance } from '../../../data-privacy';
import { parsePlace } from '../../../place-schema';

export const runtime = 'edge';

type Itinerary = { maps?: unknown; currentMap?: unknown; places?: unknown };
type ShareRecord = { share_id: string; owner_user_id: string; owner_generation: string; map_name: string; invited_email: string };

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' } });
}

function safePlace(value: unknown, mapName: string): Record<string, unknown> | null {
  const parsed = parsePlace(value, { strict: true });
  if (!parsed.place) return null;
  const place = withoutDistance(parsed.place);
  return { ...place, id: `${place.placeId}-${mapName}`, destination: mapName, note: '' };
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

    const ownerRow = await db.prepare('SELECT data_json FROM user_itineraries WHERE user_id = ? AND EXISTS (SELECT 1 FROM user_accounts WHERE user_id = ? AND generation = ?)').bind(share.owner_user_id, share.owner_user_id, share.owner_generation).first<{ data_json: string }>();
    let source: Itinerary | null = null;
    try { source = ownerRow ? JSON.parse(ownerRow.data_json) as Itinerary : null; } catch { source = null; }
    const ownerMaps = Array.isArray(source?.maps) ? source.maps : [];
    if (!ownerMaps.includes(share.map_name)) return response({ error: 'O roteiro original foi removido.' }, 404);

    // Import is another itinerary writer: recompute against the latest recipient
    // revision if an autosave won the race, rather than replace its changes.
    for (let attempt = 0; attempt < 4; attempt++) {
      const recipient = await readItinerary(user);
      const current: Itinerary = recipient.data ?? { maps: [], currentMap: '', places: [] };
      const maps = Array.isArray(current.maps) ? current.maps.filter((item): item is string => typeof item === 'string' && item.length <= 120) : [];
      const places = Array.isArray(current.places) ? current.places.filter((place) => place && typeof place === 'object').map(withoutDistance) : [];
      const existingMap = maps.find((name) => name.localeCompare(share.map_name, undefined, { sensitivity: 'base' }) === 0);
      if (!existingMap && maps.length >= 100) return response({ error: 'Sua conta já atingiu o limite de roteiros.' }, 400);
      const destination = existingMap ?? share.map_name;
      const candidates = (Array.isArray(source?.places) ? source.places : [])
        .filter((place) => place && typeof place === 'object' && ((place as { destination?: unknown }).destination ?? 'Madri') === share.map_name)
        .map((place) => safePlace(place, destination));
      if (candidates.some((place) => !place)) return response({ error: 'O roteiro contém um local inválido. Peça ao proprietário para revisar os dados antes de compartilhar.', code: 'invalid_place' }, 422);
      const imported = candidates.filter((place): place is NonNullable<typeof place> => Boolean(place));
      const existingKeys = new Set(places.map((place) => {
        const item = place as { placeId?: string; destination?: string };
        return item.placeId + ':' + (item.destination ?? 'Madri').toLocaleLowerCase();
      }));
      const additions = imported.filter((place) => {
        const key = place.placeId + ':' + destination.toLocaleLowerCase();
        if (existingKeys.has(key)) return false;
        existingKeys.add(key); return true;
      });
      const data = { maps: existingMap ? maps : [...maps, destination], currentMap: destination, places: [...places, ...additions] };
      if (JSON.stringify(data).length > 900_000) return response({ error: 'Não há espaço suficiente para copiar este roteiro.' }, 413);
      const saved = await commitItinerary(user, data, recipient.revision, [], { shareId, ownerGeneration: share.owner_generation, email: user.email.trim().toLowerCase() });
      if (saved.saved) return response({ ok: true, mapName: destination, addedCount: additions.length, revision: saved.revision });
      if (!await getSessionUser(request)) return response({ error: 'Entre com o Google para continuar' }, 401);
      if (!await db.prepare('SELECT share_id FROM map_shares WHERE share_id = ?').bind(shareId).first()) return response({ error: 'O convite mudou ou expirou. Peça um novo link.' }, 404);
    }
    return response({ error: 'Seu roteiro mudou em outro aparelho. Tente salvar novamente.', code: 'revision_conflict' }, 412);
  } catch {
    return response({ error: 'Não foi possível salvar o roteiro agora. Tente novamente.' }, 500);
  }
}
