import { database, ensureDatabase } from '../_lib/db';
import { getSessionUser } from '../_lib/auth';
import { checkExpectedAccount, checkMutation } from '../_lib/request-security';

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
    await ensureDatabase(db);
    const row = await db.prepare('SELECT data_json, updated_at FROM user_itineraries WHERE user_id = ?').bind(user.id).first<{ data_json: string; updated_at: number }>();
    return Response.json({ userId: user.id, data: row ? JSON.parse(row.data_json) : null, updatedAt: row?.updated_at ?? null }, {
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
    const payload = JSON.stringify({ ...data, updatedAt: Date.now() });
    if (payload.length > 900_000) return Response.json({ error: 'Roteiro grande demais para sincronizar' }, { status: 413 });

    const db = database();
    await ensureDatabase(db);
    const updatedAt = Date.now();
    await db.prepare(`
      INSERT INTO user_itineraries (user_id, data_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `).bind(user.id, payload, updatedAt).run();
    return Response.json({ ok: true, updatedAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Não foi possível salvar seus roteiros' }, { status: 500 });
  }
}
