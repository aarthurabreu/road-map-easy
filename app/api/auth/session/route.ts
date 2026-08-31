import { getSessionUser } from '../../_lib/auth';

export const runtime = 'edge';

export async function GET(request: Request) {
  return Response.json({ user: await getSessionUser(request) }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
