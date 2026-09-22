import { createBrowserChallenge, verifyBrowserChallenge, type SessionUser } from './auth';
import { accountIdentity } from '../../data-privacy';

export function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

// request.url is the Worker's request URL; never authorize forwarded host headers.
export function checkMutation(request: Request): Response | null {
  if (request.headers.get('origin') !== new URL(request.url).origin) return jsonError('Origem não permitida', 403);
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return jsonError('Origem não permitida', 403);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return jsonError('Envie application/json', 415);
  }
  return null;
}

export async function checkAuthMutation(request: Request): Promise<Response | null> {
  const denied = checkMutation(request);
  if (denied) return denied;
  if (!await verifyBrowserChallenge(request)) return jsonError('Reabra o login e tente novamente', 403);
  return null;
}

export function checkExpectedAccount(request: Request, user: SessionUser): Response | null {
  return request.headers.get('x-roamly-account') === accountIdentity(user) ? null : jsonError('A conta mudou. Recarregue o roteiro.', 409);
}

export { createBrowserChallenge };
