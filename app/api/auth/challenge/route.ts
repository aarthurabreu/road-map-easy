import { checkMutation, createBrowserChallenge } from '../../_lib/request-security';

export const runtime = 'edge';

export async function POST(request: Request) {
  const denied = checkMutation(request);
  if (denied) return denied;
  const challenge = await createBrowserChallenge(request);
  return Response.json({ token: challenge.token }, {
    headers: { 'Cache-Control': 'no-store', 'Set-Cookie': challenge.cookie },
  });
}
