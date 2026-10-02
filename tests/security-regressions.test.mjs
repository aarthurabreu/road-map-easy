import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { runtime } from './helpers/runtime.mjs';

const origin = 'https://app.example.invalid';
const req = (url, headers = {}, body = {}, method = 'POST') => new Request(origin + url, {
  method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
  ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
});
const pair = (cookie) => cookie.split(';')[0];
const decode = (cookie) => JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[0], 'base64url').toString());
const user = (id = 'A') => ({ id, email: id.toLowerCase() + '@example.invalid', name: id });
const identity = (cookie) => { const value = decode(cookie); return value.id + ':' + value.generation; };

async function fixture({ configured = true, id = 'A' } = {}) {
  const r = runtime();
  if (configured) Object.assign(r.context.process.env, { RESEND_API_KEY: 'synthetic-email-key', RESEND_FROM_EMAIL: 'invites@example.invalid' });
  const cookie = pair(await r.auth.createSessionCookie(user(id), req('/')));
  r.rows.set(id, JSON.stringify({ maps: ['Roma', 'Paris'], currentMap: 'Roma', places: [] }));
  const headers = await authorized(r, cookie);
  const shares = r.load('app/api/shares/route.ts');
  return { r, cookie, headers, shares };
}

async function authorized(r, cookie) {
  const challenge = await r.auth.createBrowserChallenge(req('/'));
  return { Cookie: cookie + '; ' + pair(challenge.cookie), 'X-Roamly-CSRF': challenge.token, 'X-Roamly-Account': identity(cookie) };
}
const invite = (f, email = 'friend@example.invalid', mapName = 'Roma') => f.shares.POST(req('/api/shares', f.headers, { mapName, email }));
const revoke = (f, shareId) => f.shares.DELETE(req('/api/shares?shareId=' + shareId, f.headers, {}, 'DELETE'));
const countAttempts = (r) => Number(r.sql.prepare('SELECT COUNT(*) AS total FROM invite_email_attempts').get().total);

test('logout rejects the copied cookie across private APIs, preserves other sessions, account generation and shared links', async () => {
  const f = await fixture({ configured: false });
  const otherCookie = pair(await f.r.auth.createSessionCookie(user(), req('/')));
  const shareId = (await (await invite(f)).json()).shareId;
  const logout = await f.r.load('app/api/auth/logout/route.ts').POST(req('/api/auth/logout', f.headers));
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.getSetCookie().some((cookie) => cookie.includes('roamly_session=;')));
  assert.equal(await f.r.auth.getSessionUser(req('/', { Cookie: f.cookie }, {}, 'GET')), null);
  assert.equal((await f.r.load('app/api/auth/session/route.ts').GET(req('/api/auth/session', { Cookie: f.cookie }, {}, 'GET')).then((r) => r.json())).user, null);
  assert.equal((await f.r.load('app/api/sync/route.ts').GET(req('/api/sync', f.headers, {}, 'GET'))).status, 401);
  assert.equal((await f.r.load('app/api/sync/route.ts').PUT(req('/api/sync', f.headers, { maps: [], currentMap: '', places: [] }, 'PUT'))).status, 401);
  assert.equal((await invite(f, 'other@example.invalid')).status, 401);
  assert.equal((await f.shares.GET(req('/api/shares?shareId=' + shareId, { Cookie: f.cookie }, {}, 'GET'))).status, 401);
  assert.equal((await f.r.load('app/api/shares/import/route.ts').POST(req('/api/shares/import', f.headers, { shareId }))).status, 401);
  assert.equal((await f.r.auth.getSessionUser(req('/', { Cookie: otherCookie }, {}, 'GET'))).id, 'A');
  assert.equal(f.r.accounts.get('A'), decode(f.cookie).generation);
  assert.equal(f.r.shares.size, 1);
  const publicUser = await f.r.auth.getSessionUser(req('/', { Cookie: otherCookie }, {}, 'GET'));
  assert.equal(publicUser.sid, undefined);
  const newCookie = pair(await f.r.auth.createSessionCookie(user(), req('/')));
  assert.equal(identity(newCookie), identity(f.cookie));
});

test('a replacement login retires the old browser session without disconnecting a separate device', async () => {
  const f = await fixture();
  const device = pair(await f.r.auth.createSessionCookie(user(), req('/')));
  const replacement = pair(await f.r.auth.createSessionCookie(user(), req('/', { Cookie: f.cookie })));
  const headers = await authorized(f.r, replacement);
  assert.equal((await f.r.load('app/api/auth/logout/route.ts').POST(req('/api/auth/logout', headers))).status, 200);
  assert.equal(await f.r.auth.getSessionUser(req('/', { Cookie: f.cookie }, {}, 'GET')), null);
  assert.equal(await f.r.auth.getSessionUser(req('/', { Cookie: replacement }, {}, 'GET')), null);
  assert.ok(await f.r.auth.getSessionUser(req('/', { Cookie: device }, {}, 'GET')));
});

test('the real Google login endpoint retires the replaced session across an account switch', async () => {
  const f = await fixture();
  const separateDevice = pair(await f.r.auth.createSessionCookie(user(), req('/')));
  const response = await f.r.load('app/api/auth/google/route.ts').POST(req('/api/auth/google', f.headers, { credential: 'synthetic-credential' }));
  assert.equal(response.status, 200);
  const newCookie = pair(response.headers.getSetCookie().find((cookie) => cookie.startsWith('roamly_session=')));
  assert.equal(await f.r.auth.getSessionUser(req('/', { Cookie: f.cookie }, {}, 'GET')), null);
  assert.equal((await f.r.auth.getSessionUser(req('/', { Cookie: newCookie }, {}, 'GET'))).id, 'B');
  assert.equal((await f.r.auth.getSessionUser(req('/', { Cookie: separateDevice }, {}, 'GET'))).id, 'A');
});

test('legacy, unknown, altered-expiry, duplicated and expired signed sessions are rejected', async () => {
  const f = await fixture();
  const original = decode(f.cookie);
  const sign = (value) => {
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    return 'roamly_session=' + payload + '.' + createHmac('sha256', 'synthetic-test-secret-only').update(payload).digest('hex');
  };
  const legacy = { ...original }; delete legacy.sid;
  for (const cookie of [
    sign(legacy), sign({ ...original, sid: '11111111-1111-4111-8111-111111111111' }),
    sign({ ...original, exp: original.exp + 1 }), f.cookie + '; ' + f.cookie,
  ]) assert.equal(await f.r.auth.getSessionUser(req('/', { Cookie: cookie }, {}, 'GET')), null);
  f.r.context.Date = class extends Date { static now() { return (original.exp + 1) * 1000; } };
  assert.equal(await f.r.auth.getSessionUser(req('/', { Cookie: f.cookie }, {}, 'GET')), null);
});

test('a failed revocation never claims successful logout or clears the cookie', async () => {
  const f = await fixture();
  const originalPrepare = f.r.db.prepare.bind(f.r.db);
  f.r.db.prepare = (sql) => {
    if (sql.startsWith('DELETE FROM auth_sessions WHERE session_id')) throw new Error('Synthetic DB outage');
    return originalPrepare(sql);
  };
  const response = await f.r.load('app/api/auth/logout/route.ts').POST(req('/api/auth/logout', f.headers));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.ok(await f.r.auth.getSessionUser(req('/', { Cookie: f.cookie }, {}, 'GET')));
});

test('account deletion clears all sessions; recreating the account does not restore an old cookie', async () => {
  const f = await fixture();
  const other = pair(await f.r.auth.createSessionCookie(user(), req('/')));
  const removed = await f.r.load('app/api/sync/route.ts').DELETE(req('/api/sync', f.headers, {}, 'DELETE'));
  assert.equal(removed.status, 200);
  assert.equal(Number(f.r.sql.prepare('SELECT COUNT(*) AS total FROM auth_sessions').get().total), 0);
  const recreated = pair(await f.r.auth.createSessionCookie(user(), req('/')));
  assert.notEqual(identity(recreated), identity(f.cookie));
  for (const cookie of [f.cookie, other]) assert.equal(await f.r.auth.getSessionUser(req('/', { Cookie: cookie }, {}, 'GET')), null);
  assert.ok(await f.r.auth.getSessionUser(req('/', { Cookie: recreated }, {}, 'GET')));
});

test('delete/recreate and normalized-email/map aliases cannot refund email allowance', async () => {
  const f = await fixture();
  const first = await invite(f);
  assert.equal(first.status, 201);
  const shareId = (await first.json()).shareId;
  assert.equal((await revoke(f, shareId)).status, 200);
  const retry = await invite(f, ' Friend@Example.Invalid ', 'Paris');
  assert.equal(retry.status, 201);
  const manual = await retry.json();
  assert.equal(manual.emailRateLimited, true);
  assert.equal(manual.emailSent, false);
  assert.equal(f.r.state.emailCalls.length, 1);
  assert.equal(countAttempts(f.r), 1);
  assert.equal(f.r.shares.size, 1);
  const recipient = pair(await f.r.auth.createSessionCookie({ id: 'friend', email: 'friend@example.invalid', name: 'Friend' }, req('/')));
  assert.equal((await f.shares.GET(req('/api/shares?shareId=' + manual.shareId, { Cookie: recipient }, {}, 'GET'))).status, 200);
  const attempt = f.r.sql.prepare('SELECT * FROM invite_email_attempts').get();
  assert.match(attempt.owner_key, /^[0-9a-f]{64}$/);
  assert.match(attempt.recipient_key, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(attempt).includes('example.invalid'), false);
});

test('map deletion and account recreation do not reset the invitation budget', async () => {
  const f = await fixture();
  assert.equal((await invite(f)).status, 201);
  const sync = f.r.load('app/api/sync/route.ts');
  assert.equal((await sync.PUT(req('/api/sync', f.headers, { maps: [], currentMap: '', places: [], baseRevision: 0, mutationIds: [crypto.randomUUID()] }, 'PUT'))).status, 200);
  assert.equal(f.r.shares.size, 0);
  f.r.rows.set('A', JSON.stringify({ maps: ['Roma'], places: [] }));
  assert.equal((await (await invite(f)).json()).emailRateLimited, true);
  assert.equal((await sync.DELETE(req('/api/sync', f.headers, {}, 'DELETE'))).status, 200);
  const recreated = pair(await f.r.auth.createSessionCookie(user(), req('/')));
  f.headers = await authorized(f.r, recreated);
  f.r.rows.set('A', JSON.stringify({ maps: ['Roma'], places: [] }));
  assert.equal((await (await invite(f)).json()).emailRateLimited, true);
  assert.equal(f.r.state.emailCalls.length, 1);
});

test('concurrent requests reserve atomically: hourly allowance is not exceeded and duplicate invitations send once', async () => {
  const f = await fixture();
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => invite(f, 'person' + index + '@example.invalid')));
  assert.equal(responses.filter((response) => response.status === 201).length, 12);
  const payloads = await Promise.all(responses.map((response) => response.json()));
  assert.equal(payloads.filter((payload) => payload.emailSent).length, 10);
  assert.equal(payloads.filter((payload) => payload.emailRateLimited).length, 2);
  assert.equal(f.r.state.emailCalls.length, 10);
  assert.equal(countAttempts(f.r), 10);
  const second = await fixture();
  const duplicates = await Promise.all([invite(second), invite(second), invite(second)]);
  assert.deepEqual(duplicates.map((response) => response.status).sort(), [200, 200, 201]);
  assert.equal(second.r.state.emailCalls.length, 1);
  assert.equal(countAttempts(second.r), 1);
  assert.equal(second.r.shares.size, 1);
  assert.match(second.r.state.emailCalls[0].headers.get('idempotency-key'), /^invitation\//);
});

test('provider failures consume allowance; absent provider configuration preserves manual-link fallback without spending it', async () => {
  const f = await fixture();
  f.r.state.failEmail = true;
  const response = await invite(f);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.emailSent, false);
  await revoke(f, payload.shareId);
  assert.equal((await (await invite(f)).json()).emailRateLimited, true);
  assert.equal(f.r.state.emailCalls.length, 1);
  const manual = await fixture({ configured: false });
  for (let index = 0; index < 4; index++) {
    const created = await invite(manual);
    assert.equal(created.status, 201);
    const data = await created.json();
    assert.equal(data.emailSent, false);
    await revoke(manual, data.shareId);
  }
  assert.equal(countAttempts(manual.r), 0);
  assert.equal(manual.r.state.emailCalls.length, 0);
});

test('daily account, recipient-wide and global limits survive cooldown; expired records are cleaned', async () => {
  for (const mode of ['account', 'recipient', 'global']) {
    const f = await fixture();
    const ownerKey = await f.r.auth.invitationFingerprint('account', 'A');
    const recipientKey = await f.r.auth.invitationFingerprint('recipient', 'friend@example.invalid');
    const limits = f.r.load('app/api/_lib/invitations.ts').invitationEmailLimits;
    const total = mode === 'account' ? limits.accountPerDay : mode === 'recipient' ? limits.recipientPerDay : limits.globalPerDay;
    const seed = f.r.sql.prepare('INSERT INTO invite_email_attempts VALUES (?, ?, ?, ?)');
    for (let index = 0; index < total; index++) seed.run('old-' + index, mode === 'account' ? ownerKey : 'other-' + index, mode === 'recipient' ? recipientKey : 'other-' + index, Date.now() - 2 * 60 * 60 * 1000);
    const limited = await invite(f);
    assert.equal(limited.status, 201, mode);
    const manual = await limited.json();
    assert.equal(manual.emailRateLimited, true, mode);
    assert.equal(f.r.shares.size, 1);
    assert.equal(f.r.state.emailCalls.length, 0);
    await revoke(f, manual.shareId);
    f.r.sql.prepare('UPDATE invite_email_attempts SET created_at = ?').run(Date.now() - 24 * 60 * 60 * 1000 - 1000);
    assert.equal((await invite(f)).status, 201);
    assert.equal(countAttempts(f.r), 1);
  }
});

test('failed reservation rolls back invitation creation; concurrent active-invite cap is enforced by SQL', async () => {
  const f = await fixture();
  const batch = f.r.db.batch.bind(f.r.db);
  f.r.db.batch = (statements) => batch([...statements, f.r.db.prepare('INSERT INTO nonexistent_table VALUES (?)').bind('synthetic failure')]);
  assert.equal((await invite(f)).status, 500);
  assert.equal(f.r.shares.size, 0);
  assert.equal(countAttempts(f.r), 0);
  assert.equal(f.r.state.emailCalls.length, 0);
  f.r.db.batch = batch;
  assert.equal((await invite(f)).status, 201);
  assert.equal(f.r.shares.size, 1);
  assert.equal(countAttempts(f.r), 1);
  const manual = await fixture({ configured: false });
  const responses = await Promise.all(Array.from({ length: 52 }, (_, index) => invite(manual, 'person' + index + '@example.invalid')));
  assert.equal(responses.filter((response) => response.status === 201).length, 50);
  assert.equal(responses.filter((response) => response.status === 429).length, 2);
  assert.equal(manual.r.shares.size, 50);
});
