import { database } from './db';
import { invitationFingerprint, type SessionUser } from './auth';

const hour = 60 * 60 * 1000;
const day = 24 * hour;
export const invitationEmailLimits = {
  accountPerHour: 10,
  accountPerDay: 50,
  recipientPerDay: 20,
  globalPerDay: 500,
  recipientCooldownMs: 5 * 60 * 1000,
} as const;

function emailSettings() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const sender = process.env.RESEND_FROM_EMAIL?.trim();
  return apiKey && sender && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(sender) ? { apiKey, sender } : null;
}

type InvitationResult =
  | { kind: 'created' | 'existing'; shareId: string; emailSent: boolean; emailRateLimited: boolean }
  | { kind: 'capacity' }
  | { kind: 'account-changed' };

export async function createInvitation(user: SessionUser, mapName: string, email: string): Promise<InvitationResult> {
  const db = database();
  const existingQuery = () => db.prepare('SELECT share_id FROM map_shares WHERE owner_user_id = ? AND owner_generation = ? AND map_name = ? AND invited_email = ?')
    .bind(user.id, user.generation, mapName, email).first<{ share_id: string }>();
  const existing = await existingQuery();
  if (existing) return { kind: 'existing', shareId: existing.share_id, emailSent: false, emailRateLimited: false };
  const shareId = crypto.randomUUID();
  const now = Date.now();
  const settings = emailSettings();
  const insertShare = db.prepare(`
    INSERT OR IGNORE INTO map_shares (share_id, owner_user_id, owner_generation, map_name, invited_email, created_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM user_accounts WHERE user_id = ? AND generation = ?)
      AND (SELECT COUNT(*) FROM map_shares WHERE owner_user_id = ? AND owner_generation = ? AND map_name = ?) < 50
  `).bind(shareId, user.id, user.generation, mapName, email, now, user.id, user.generation, user.id, user.generation, mapName);
  const statements = [insertShare];
  if (settings) {
    const [ownerKey, recipientKey] = await Promise.all([
      invitationFingerprint('account', user.id), invitationFingerprint('recipient', email),
    ]);
    // D1 batch is a single transaction. Each conditional INSERT sees earlier
    // reservations; revoke/map/account deletion never refunds this ledger.
    await db.prepare('DELETE FROM invite_email_attempts WHERE created_at <= ?').bind(now - day).run();
    statements.push(db.prepare(`
      INSERT INTO invite_email_attempts (attempt_id, owner_key, recipient_key, created_at)
      SELECT ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM map_shares WHERE share_id = ?)
        AND (SELECT COUNT(*) FROM invite_email_attempts WHERE owner_key = ? AND created_at > ?) < ?
        AND (SELECT COUNT(*) FROM invite_email_attempts WHERE owner_key = ? AND created_at > ?) < ?
        AND (SELECT COUNT(*) FROM invite_email_attempts WHERE recipient_key = ? AND created_at > ?) < ?
        AND (SELECT COUNT(*) FROM invite_email_attempts WHERE created_at > ?) < ?
        AND NOT EXISTS (SELECT 1 FROM invite_email_attempts WHERE owner_key = ? AND recipient_key = ? AND created_at > ?)
    `).bind(shareId, ownerKey, recipientKey, now, shareId,
      ownerKey, now - hour, invitationEmailLimits.accountPerHour,
      ownerKey, now - day, invitationEmailLimits.accountPerDay,
      recipientKey, now - day, invitationEmailLimits.recipientPerDay,
      now - day, invitationEmailLimits.globalPerDay,
      ownerKey, recipientKey, now - invitationEmailLimits.recipientCooldownMs));
  }
  const results = await db.batch(statements);
  if (!results[0].meta.changes) {
    const raced = await existingQuery();
    if (raced) return { kind: 'existing', shareId: raced.share_id, emailSent: false, emailRateLimited: false };
    const account = await db.prepare('SELECT generation FROM user_accounts WHERE user_id = ?').bind(user.id).first<{ generation: string }>();
    return { kind: account?.generation === user.generation ? 'capacity' : 'account-changed' };
  }
  const emailRateLimited = !!settings && !results[1].meta.changes;
  // Attempted sends consume allowance even when the provider is unavailable.
  const emailSent = settings && !emailRateLimited ? await sendInviteEmail(email, mapName, shareId, settings) : false;
  return { kind: 'created', shareId, emailSent, emailRateLimited };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>\"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

async function sendInviteEmail(to: string, mapName: string, shareId: string, settings: { apiKey: string; sender: string }) {
  const { apiKey, sender } = settings;
  const link = `https://roamly-trip-guide-arthur.arthurmaquizito.chatgpt.site/share/${encodeURIComponent(shareId)}`;
  const safeMap = escapeHtml(mapName);
  const safeTo = escapeHtml(to);
  const safeSubject = mapName.replace(/[\r\n]+/g, ' ');
  const text = `Você foi convidado para ver o roteiro “${mapName}” no Easy Road Map. Entre com a Conta Google ${to} e abra este link: ${link}`;
  try {
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `invitation/${shareId}` },
      body: JSON.stringify({
        from: `Easy Road Map <${sender}>`,
        to: [to],
        subject: `Convite para o roteiro ${safeSubject}`,
        text,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;color:#19251d"><p style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#1f7a50">EASY ROAD MAP</p><h1 style="font-size:26px">Seu próximo roteiro está esperando</h1><p>Você foi convidado para ver o roteiro <strong>“${safeMap}”</strong>.</p><p>Abra usando a Conta Google <strong>${safeTo}</strong> que recebeu este convite.</p><p style="margin:28px 0"><a href="${link}" style="display:inline-block;padding:14px 20px;border-radius:10px;background:#1f7a50;color:#fff;text-decoration:none;font-weight:700">Abrir roteiro</a></p><p style="font-size:13px;color:#647168">Se o botão não funcionar, copie este link: <a href="${link}">${link}</a></p></div>`,
      }),
    });
    return result.ok;
  } catch { return false; }
}
