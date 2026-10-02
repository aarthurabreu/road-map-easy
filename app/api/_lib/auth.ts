import { database } from './db';

export type GoogleUser = {
  id: string;
  email: string;
  name: string;
  picture?: string;
};
export type SessionUser = GoogleUser & { generation: string };

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
const challengeCookieName = 'roamly_login_challenge';
type SignedSession = SessionUser & { sid: string; exp: number };

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

// Domain-separated, non-reversible keys keep short-lived anti-abuse records
// independent of account generations without retaining raw IDs or emails.
export function invitationFingerprint(kind: 'account' | 'recipient', value: string) {
  return signature(`invitation-budget:${kind}:${value}`);
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function cookieValue(request: Request, name: string) {
  const values = (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
}

export async function createBrowserChallenge(request: Request) {
  const payload = encode(JSON.stringify({ nonce: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 600 }));
  const token = `${payload}.${await signature(`login:${payload}`)}`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return { token, cookie: `${challengeCookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=600${secure}` };
}

export async function verifyBrowserChallenge(request: Request) {
  const token = request.headers.get('x-roamly-csrf') ?? '';
  const cookie = cookieValue(request, challengeCookieName);
  if (!token || token.length > 1024 || !cookie || !timingSafeEqual(token, cookie)) return false;
  try {
    const separator = token.lastIndexOf('.');
    if (separator < 1) return false;
    const payload = token.slice(0, separator);
    if (!timingSafeEqual(token.slice(separator + 1), await signature(`login:${payload}`))) return false;
    const value = JSON.parse(decode(payload)) as { nonce?: string; exp?: number };
    return typeof value.nonce === 'string' && typeof value.exp === 'number' && value.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

export function clearBrowserChallenge(request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${challengeCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function getGoogleClientId() {
  return clientId();
}

export async function verifyGoogleCredential(credential: string): Promise<GoogleUser> {
  const expectedAudience = clientId();
  if (!expectedAudience) throw new Error('GOOGLE_OAUTH_CLIENT_ID não configurado');
  if (typeof credential !== 'string' || !credential || credential.length > 10_000) throw new Error('Credencial Google inválida');

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
  const db = database();
  await db.prepare('INSERT OR IGNORE INTO user_accounts (user_id, generation) VALUES (?, ?)').bind(user.id, crypto.randomUUID()).run();
  const account = await db.prepare('SELECT generation FROM user_accounts WHERE user_id = ?').bind(user.id).first<{ generation: string }>();
  if (!account) throw new Error('Não foi possível iniciar a conta. Tente novamente.');
  const now = Math.floor(Date.now() / 1000);
  const sid = crypto.randomUUID();
  const exp = now + sessionLifetimeSeconds;
  await db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now).run();
  const previous = await readSignedSession(request);
  const register = db.prepare(`
    INSERT INTO auth_sessions (session_id, user_id, generation, expires_at)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM user_accounts WHERE user_id = ? AND generation = ?)
  `).bind(sid, user.id, account.generation, exp, user.id, account.generation);
  const statements = [register];
  if (previous) statements.push(db.prepare(`
    DELETE FROM auth_sessions WHERE session_id = ? AND user_id = ? AND generation = ?
      AND EXISTS (SELECT 1 FROM auth_sessions WHERE session_id = ?)
  `).bind(previous.sid, previous.id, previous.generation, sid));
  const [saved] = await db.batch(statements);
  if (!saved.meta.changes) throw new Error('A conta mudou. Entre novamente.');
  const payload = encode(JSON.stringify({ ...user, generation: account.generation, sid, exp }));
  const signed = `${payload}.${await signature(payload)}`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName}=${signed}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetimeSeconds}${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

async function readSignedSession(request: Request): Promise<SignedSession | null> {
  const value = cookieValue(request, cookieName);
  if (!value || value.length > 16_384) return null;
  const separator = value.lastIndexOf('.');
  if (separator < 1) return null;
  const payload = value.slice(0, separator);
  const receivedSignature = value.slice(separator + 1);
  try {
    if (!timingSafeEqual(receivedSignature, await signature(payload))) return null;
    const parsed = JSON.parse(decode(payload)) as SignedSession;
    if (typeof parsed.id !== 'string' || !parsed.id || typeof parsed.email !== 'string' || !parsed.email || typeof parsed.generation !== 'string' || !parsed.generation
      || typeof parsed.sid !== 'string' || !/^[0-9a-f-]{36}$/i.test(parsed.sid) || !Number.isSafeInteger(parsed.exp) || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const parsed = await readSignedSession(request);
  if (!parsed) return null;
  try {
    const active = await database().prepare(`
      SELECT s.session_id FROM auth_sessions s
      JOIN user_accounts a ON a.user_id = s.user_id AND a.generation = s.generation
      WHERE s.session_id = ? AND s.user_id = ? AND s.generation = ? AND s.expires_at = ? AND s.expires_at > ?
    `).bind(parsed.sid, parsed.id, parsed.generation, parsed.exp, Math.floor(Date.now() / 1000)).first();
    if (!active) return null;
    // Do not expose the server's session identifier through /api/auth/session.
    return { id: parsed.id, email: parsed.email, name: parsed.name || parsed.email, picture: parsed.picture, generation: parsed.generation };
  } catch { return null; }
}

export async function revokeSession(request: Request, user: SessionUser) {
  const parsed = await readSignedSession(request);
  if (!parsed || parsed.id !== user.id || parsed.generation !== user.generation) throw new Error('Sessão inválida');
  await database().prepare('DELETE FROM auth_sessions WHERE session_id = ? AND user_id = ? AND generation = ?')
    .bind(parsed.sid, user.id, user.generation).run();
}
