'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, LocateFixed, ShieldCheck, Trash2, X } from 'lucide-react';
import type { Language } from './i18n';
import { privacyContact, privacyCopy } from './privacy-copy';

export function PrivacyDialog({ language, email, locationEnabled, onLocation, onExport, onDelete, onClose }: {
  language: Language; email?: string; locationEnabled: boolean;
  onLocation: () => void; onExport: () => Promise<void>; onDelete: () => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [error, setError] = useState('');
  const p = privacyCopy[language];
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function perform(action: 'export' | 'delete') {
    setBusy(action); setError('');
    try { await (action === 'export' ? onExport() : onDelete()); }
    catch { setError(p.failure); }
    finally { setBusy(null); }
  }
  return <dialog ref={dialog} className="privacy-dialog" aria-labelledby="privacy-title" onCancel={(event) => { if (busy) event.preventDefault(); }} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="privacy-content">
      <div className="modal-heading"><div><span>Easy Road Map</span><h2 id="privacy-title">{confirming ? p.confirmTitle : p.title}</h2></div><button disabled={!!busy} onClick={onClose} aria-label={p.close}><X size={20} /></button></div>
      {confirming ? <>
        {email && <p className="privacy-account">{email}</p>}
        <p>{email ? p.confirmAccount : p.confirmLocal}</p>
        <div className="privacy-actions"><button disabled={!!busy} onClick={() => setConfirming(false)}>{p.cancel}</button><button className="privacy-danger" disabled={!!busy} onClick={() => void perform('delete')}><Trash2 size={18} />{busy === 'delete' ? p.deleting : p.confirm}</button></div>
      </> : <>
        <section className="privacy-tools">
          <button disabled={!!busy} onClick={() => void perform('export')}><Download size={18} />{busy === 'export' ? p.downloading : p.download}</button>
          <p>{p.exportHint}</p>
          <button className="privacy-danger" disabled={!!busy} onClick={() => { setError(''); setConfirming(true); }}><Trash2 size={18} />{email ? p.deleteAccount : p.deleteLocal}</button>
        </section>
        <section className="privacy-location"><h3><LocateFixed size={18} />{locationEnabled ? p.locationOn : p.locationOff}</h3><p>{p.locationHelp}</p><button disabled={!!busy} onClick={onLocation}>{locationEnabled ? p.disable : p.enable}</button><p>{p.locationHint}</p></section>
        {p.sections.map(([title, body]) => <section key={title}><h3>{title}</h3><p>{body}</p></section>)}
        <section><h3><ShieldCheck size={18} />{p.contact}</h3><a href={`mailto:${privacyContact}`}>{privacyContact}</a><div className="privacy-links"><a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">{p.googlePolicy}</a><a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">{p.cloudflarePolicy}</a></div></section>
      </>}
      {error && <p role="alert" className="auth-error">{error}</p>}
    </div>
  </dialog>;
}

export function LocationDialog({ language, onAllow, onClose }: { language: Language; onAllow: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const p = privacyCopy[language];
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="privacy-dialog location-dialog" aria-labelledby="location-title" onClose={onClose}>
    <div className="privacy-content"><div className="modal-heading"><h2 id="location-title">{p.locationTitle}</h2><button onClick={onClose} aria-label={p.close}><X size={20} /></button></div><p>{p.locationHelp}</p><div className="privacy-actions"><button onClick={onClose}>{p.later}</button><button className="privacy-primary" onClick={onAllow}><LocateFixed size={18} />{p.enable}</button></div></div>
  </dialog>;
}
