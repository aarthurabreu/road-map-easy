import { createSessionCookie, verifyGoogleCredential } from '../../_lib/auth';

export const runtime = 'edge';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { credential?: string };
    const user = await verifyGoogleCredential(body.credential ?? '');
    return Response.json({ user }, {
      headers: { 'Cache-Control': 'no-store', 'Set-Cookie': await createSessionCookie(user, request) },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Não foi possível entrar com o Google' }, {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
