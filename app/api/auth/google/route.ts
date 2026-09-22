import { clearBrowserChallenge, createSessionCookie, verifyGoogleCredential } from '../../_lib/auth';
import { checkAuthMutation } from '../../_lib/request-security';

export const runtime = 'edge';

export async function POST(request: Request) {
  try {
    const denied = await checkAuthMutation(request);
    if (denied) return denied;
    const body = await request.json() as { credential?: string };
    const user = await verifyGoogleCredential(body.credential ?? '');
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', await createSessionCookie(user, request));
    headers.append('Set-Cookie', clearBrowserChallenge(request));
    return Response.json({ user }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Não foi possível entrar com o Google' }, {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
