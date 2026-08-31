import { getGoogleClientId } from '../../_lib/auth';

export const runtime = 'edge';

export async function GET() {
  return Response.json({ clientId: getGoogleClientId() }, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
