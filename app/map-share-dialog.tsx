'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Mail, Share2, Trash2, X } from 'lucide-react';
import type { Language } from './i18n';
import { accountFetch, authChallenge } from './account-storage';
import { privacyCopy } from './privacy-copy';

type MapShare = { share_id: string; invited_email: string; created_at: number };

export function MapShareDialog({ mapName, language, email, identity, onClose }: {
  mapName: string; language: Language; email: string; identity: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [shares, setShares] = useState<MapShare[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const t = privacyCopy[language];
  const copy = {
    pt: { title: 'Compartilhar mapa', helper: 'Apenas a pessoa convidada por e-mail poderá abrir este mapa. Ela precisa entrar no app com a mesma Conta Google. Suas notas pessoais não serão compartilhadas.', email: 'E-mail convidado', invite: 'Criar convite', invites: 'Pessoas convidadas', empty: 'Ninguém foi convidado para este mapa ainda.', copy: 'Copiar link', mail: 'Enviar convite', revoke: 'Revogar', created: 'Convite criado. Envie o link para a pessoa.', copied: 'Link copiado.', revoked: 'Convite revogado.', failure: 'Não foi possível concluir. Tente novamente.', invalid: 'Digite um e-mail válido.' },
    es: { title: 'Compartir mapa', helper: 'Solo la persona invitada por correo podrá abrir este mapa. Debe entrar en la app con la misma Cuenta de Google. No se compartirán tus notas personales.', email: 'Correo invitado', invite: 'Crear invitación', invites: 'Personas invitadas', empty: 'Todavía no hay invitados para este mapa.', copy: 'Copiar enlace', mail: 'Enviar invitación', revoke: 'Revocar', created: 'Invitación creada. Envía el enlace a la persona.', copied: 'Enlace copiado.', revoked: 'Invitación revocada.', failure: 'No se pudo completar. Inténtalo de nuevo.', invalid: 'Escribe un correo válido.' },
    en: { title: 'Share map', helper: 'Only the person invited by email can open this map. They must sign in to the app with the same Google Account. Your personal notes will not be shared.', email: 'Invited email', invite: 'Create invite', invites: 'Invited people', empty: 'No one has been invited to this map yet.', copy: 'Copy link', mail: 'Send invitation', revoke: 'Revoke', created: 'Invite created. Send the link to the person.', copied: 'Link copied.', revoked: 'Invite revoked.', failure: 'Could not complete. Try again.', invalid: 'Enter a valid email.' },
  }[language];
  const pathFor = (shareId: string) => `${window.location.origin}/share/${encodeURIComponent(shareId)}`;

  async function loadShares() {
    setError('');
    try {
      const response = await accountFetch(identity, `/api/shares?mapName=${encodeURIComponent(mapName)}`);
      if (!response.ok) throw new Error(copy.failure);
      const result = await response.json() as { shares?: MapShare[] };
      setShares(result.shares ?? []);
    } catch { setError(copy.failure); }
  }

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    void loadShares();
    return () => element?.close();
  }, []);

  async function createInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) { setError(copy.invalid); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const csrf = await authChallenge();
      const response = await accountFetch(identity, '/api/shares', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Roamly-CSRF': csrf },
        body: JSON.stringify({ mapName, email: normalizedEmail }),
      });
      const result = await response.json() as { shareId?: string; email?: string; error?: string };
      if (!response.ok || !result.shareId) throw new Error(result.error || copy.failure);
      setInviteEmail('');
      setNotice(copy.created);
      await loadShares();
      try { await navigator.clipboard.writeText(pathFor(result.shareId)); } catch { /* The copy and mail controls remain available below. */ }
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.failure); }
    finally { setBusy(false); }
  }

  async function revoke(shareId: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const csrf = await authChallenge();
      const response = await accountFetch(identity, `/api/shares?shareId=${encodeURIComponent(shareId)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Roamly-CSRF': csrf }, body: '{}',
      });
      if (!response.ok) throw new Error(copy.failure);
      setShares((current) => current.filter((item) => item.share_id !== shareId));
      setNotice(copy.revoked);
    } catch { setError(copy.failure); }
    finally { setBusy(false); }
  }

  async function copyLink(shareId: string) {
    try { await navigator.clipboard.writeText(pathFor(shareId)); setNotice(copy.copied); setError(''); }
    catch { setError(copy.failure); }
  }

  function emailLink(item: MapShare) {
    const subject = language === 'pt' ? `Convite para o mapa ${mapName}` : language === 'es' ? `Invitación al mapa ${mapName}` : `Invitation to the ${mapName} map`;
    const body = language === 'pt' ? `Você foi convidado para ver o mapa “${mapName}” no Easy Road Map. Entre com a Conta Google ${item.invited_email} e abra este link: ${pathFor(item.share_id)}` : language === 'es' ? `Te han invitado a ver el mapa “${mapName}” en Easy Road Map. Inicia sesión con la Cuenta de Google ${item.invited_email} y abre este enlace: ${pathFor(item.share_id)}` : `You are invited to view the “${mapName}” map in Easy Road Map. Sign in with the Google Account ${item.invited_email} and open this link: ${pathFor(item.share_id)}`;
    return `mailto:${encodeURIComponent(item.invited_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return <dialog ref={dialog} className="map-share-dialog" aria-labelledby="share-map-title" onCancel={(event) => { if (busy) event.preventDefault(); }} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="map-share-content">
      <div className="modal-heading"><div><span>{mapName}</span><h2 id="share-map-title">{copy.title}</h2></div><button disabled={busy} onClick={onClose} aria-label={t.close}><X size={20} /></button></div>
      <p className="share-help">{copy.helper}</p>
      <p className="share-owner">{language === 'pt' ? 'Compartilhado por' : language === 'es' ? 'Compartido por' : 'Shared by'} {email}</p>
      <form className="share-invite-form" onSubmit={(event) => void createInvite(event)}>
        <label htmlFor="share-email">{copy.email}</label>
        <div><input id="share-email" type="email" required maxLength={254} autoComplete="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="pessoa@email.com" /><button disabled={busy}>{busy ? '…' : <><Share2 size={17} />{copy.invite}</>}</button></div>
      </form>
      <section className="share-list"><h3>{copy.invites}</h3>{shares.length === 0 ? <p className="share-empty">{copy.empty}</p> : shares.map((item) => <article className="share-person" key={item.share_id}>
        <div><strong>{item.invited_email}</strong><small>{new Date(item.created_at).toLocaleDateString(language === 'es' ? 'es-ES' : language === 'en' ? 'en-US' : 'pt-BR')}</small></div>
        <button type="button" title={copy.copy} aria-label={`${copy.copy}: ${item.invited_email}`} disabled={busy} onClick={() => void copyLink(item.share_id)}><Copy size={16} /></button>
        <a title={copy.mail} aria-label={`${copy.mail}: ${item.invited_email}`} href={emailLink(item)}><Mail size={16} /></a>
        <button type="button" className="share-revoke" title={copy.revoke} aria-label={`${copy.revoke}: ${item.invited_email}`} disabled={busy} onClick={() => void revoke(item.share_id)}><Trash2 size={16} /></button>
      </article>)}</section>
      {notice && <p role="status" className="share-notice">{notice}</p>}
      {error && <p role="alert" className="auth-error">{error}</p>}
      <button className="share-done" onClick={onClose}>{t.cancel}</button>
    </div>
  </dialog>;
}
