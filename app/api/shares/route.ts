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

function escapeHtml(value: string) {
  return value.replace(/[&<>\"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

async function sendInviteEmail(to: string, mapName: string, shareId: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const sender = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !sender || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(sender)) return false;
  const link = `https://roamly-trip-guide-arthur.arthurmaquizito.chatgpt.site/share/${encodeURIComponent(shareId)}`;
  const safeMap = escapeHtml(mapName);
  const safeTo = escapeHtml(to);
  const safeSubject = mapName.replace(/[\r\n]+/g, ' ');
  const text = `Você foi convidado para ver o roteiro “${mapName}” no Easy Road Map. Entre com a Conta Google ${to} e abra este link: ${link}`;
  try {
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Easy Road Map <${sender}>`,
        to: [to],
        subject: `Convite para o roteiro ${safeSubject}`,
        text,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;color:#19251d"><p style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#1f7a50">EASY ROAD MAP</p><h1 style="font-size:26px">Seu próximo roteiro está esperando</h1><p>Você foi convidado para ver o roteiro <strong>“${safeMap}”</strong>.</p><p>Abra usando a Conta Google <strong>${safeTo}</strong> que recebeu este convite.</p><p style="margin:28px 0"><a href="${link}" style="display:inline-block;padding:14px 20px;border-radius:10px;background:#1f7a50;color:#fff;text-decoration:none;font-weight:700">Abrir roteiro</a></p><p style="font-size:13px;color:#647168">Se o botão não funcionar, copie este link: <a href="${link}">${link}</a></p></div>`,
      }),
    });
    return result.ok;
  } catch { return false; }
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
    if (existing) return privateResponse({ shareId: existing.share_id, email, mapName, created: false, emailSent: false });
    if ((count?.total ?? 0) >= 50) return privateResponse({ error: 'Este mapa já atingiu o limite de 50 convites.' }, 429);
    const shareId = crypto.randomUUID();
    await db.prepare('INSERT INTO map_shares (share_id, owner_user_id, owner_generation, map_name, invited_email, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM user_accounts WHERE user_id = ? AND generation = ?)').bind(shareId, user.id, user.generation, mapName, email, Date.now(), user.id, user.generation).run();
    const created = await db.prepare('SELECT share_id FROM map_shares WHERE owner_user_id = ? AND owner_generation = ? AND map_name = ? AND invited_email = ?').bind(user.id, user.generation, mapName, email).first<{ share_id: string }>();
    if (!created) return unauthorized();
    const emailSent = await sendInviteEmail(email, mapName, created.share_id);
    return privateResponse({ shareId: created.share_id, email, mapName, created: true, emailSent }, 201);
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
