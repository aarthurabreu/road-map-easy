import { clearSessionCookie } from '../../_lib/auth';

export const runtime = 'edge';

export async function POST(request: Request) {
  return Response.json({ ok: true }, {
    headers: { 'Cache-Control': 'no-store', 'Set-Cookie': clearSessionCookie(request) },
  });
}
