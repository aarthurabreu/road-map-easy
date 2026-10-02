'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

// Native modal dialogs provide inert background content, a keyboard focus trap
// and Escape handling. Restore the invoking control when the dialog unmounts.
export function ModalDialog({ children, onClose, className = '', role = 'dialog', ...labels }: {
  children: ReactNode; onClose: () => void; className?: string; role?: 'dialog' | 'alertdialog';
  'aria-label'?: string; 'aria-labelledby'?: string; 'aria-describedby'?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { dialog?.close(); if (invoker?.isConnected) invoker.focus(); };
  }, []);
  return <dialog ref={ref} className={`native-modal ${className}`} role={role} aria-modal="true" {...labels}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    {children}
  </dialog>;
}
