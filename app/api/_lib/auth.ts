export type GoogleUser = {
  id: string;
  email: string;
  name: string;
  picture?: string;
};

type GoogleTokenInfo = {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  picture?: string;
  exp?: string;
};

const cookieName = 'roamly_session';
const sessionLifetimeSeconds = 60 * 60 * 24 * 7;

function clientId() {
  return process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? '';
}

function sessionSecret() {
  return process.env.GOOGLE_AUTH_SESSION_SECRET?.trim() ?? '';
}

function encode(value: string) {
  return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decode(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return decodeURIComponent(escape(atob(padded)));
}

async function signature(value: string) {
  const secret = sessionSecret();
  if (!secret) throw new Error('GOOGLE_AUTH_SESSION_SECRET não configurado');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export function getGoogleClientId() {
  return clientId();
}

export async function verifyGoogleCredential(credential: string): Promise<GoogleUser> {
  const expectedAudience = clientId();
  if (!expectedAudience) throw new Error('GOOGLE_OAUTH_CLIENT_ID não configurado');
  if (!credential || credential.length > 10_000) throw new Error('Credencial Google inválida');

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('O Google recusou esta credencial');
  const token = await response.json() as GoogleTokenInfo;
  if (token.aud !== expectedAudience || token.email_verified !== 'true' || !token.sub || !token.email) {
    throw new Error('Credencial Google não pertence ao Roamly');
  }
  if (Number(token.exp ?? 0) <= Math.floor(Date.now() / 1000)) throw new Error('Credencial Google expirada');

  return { id: token.sub, email: token.email, name: token.name || token.email.split('@')[0], picture: token.picture };
}

export async function createSessionCookie(user: GoogleUser, request: Request) {
  const payload = encode(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + sessionLifetimeSeconds }));
  const signed = `${payload}.${await signature(payload)}`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName}=${signed}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetimeSeconds}${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function getSessionUser(request: Request): Promise<GoogleUser | null> {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const value = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator < 1) return null;
  const payload = value.slice(0, separator);
  const receivedSignature = value.slice(separator + 1);
  try {
    if (!timingSafeEqual(receivedSignature, await signature(payload))) return null;
    const parsed = JSON.parse(decode(payload)) as GoogleUser & { exp?: number };
    if (!parsed.id || !parsed.email || !parsed.exp || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id: parsed.id, email: parsed.email, name: parsed.name || parsed.email, picture: parsed.picture };
  } catch {
    return null;
  }
}
