import { clearBrowserChallenge, clearSessionCookie, getSessionUser, revokeSession } from '../../_lib/auth';
import { checkAuthMutation, checkExpectedAccount, jsonError } from '../../_lib/request-security';

export const runtime = 'edge';

export async function POST(request: Request) {
  const denied = await checkAuthMutation(request);
  if (denied) return denied;
  const user = await getSessionUser(request);
  if (!user) return jsonError('Sessão encerrada', 401);
  const mismatch = checkExpectedAccount(request, user);
  if (mismatch) return mismatch;
  try {
    await revokeSession(request, user);
  } catch {
    return jsonError('Não foi possível encerrar a sessão. Tente novamente.', 503);
  }
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', clearSessionCookie(request));
  headers.append('Set-Cookie', clearBrowserChallenge(request));
  return Response.json({ ok: true }, { headers });
}
