'use client';

import { useSyncExternalStore } from 'react';
import { normalizeLanguage, languageLocales } from '../i18n';

const changed = 'roamly-preferences-change';
function snapshot() {
  let language = normalizeLanguage(document.documentElement.lang.split('-')[0]);
  try { const stored = localStorage.getItem('roamly-language'); if (stored !== null) language = normalizeLanguage(stored); } catch { /* Use the DOM preference. */ }
  const dark = document.documentElement.dataset.theme === 'dark';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return [language, dark ? 'dark' : 'light', standalone ? 'standalone' : 'browser', ios ? 'ios' : 'other'].join('|');
}

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(changed, listener);
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const displayMode = window.matchMedia('(display-mode: standalone)');
  displayMode.addEventListener('change', listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(changed, listener);
    displayMode.removeEventListener('change', listener);
    observer.disconnect();
  };
}

export function useBrowserEnvironment() {
  // Browser-owned state uses a stable primitive snapshot and SSR defaults,
  // rather than synchronously initializing React state inside effects.
  const value = useSyncExternalStore(subscribe, snapshot, () => 'pt|light|standalone|other');
  const [languageValue, theme, displayMode, platform] = value.split('|');
  return {
    language: normalizeLanguage(languageValue), dark: theme === 'dark',
    showInstallHelp: displayMode === 'browser', isIos: platform === 'ios',
  };
}

export function setBrowserLanguage(value: string) {
  const next = normalizeLanguage(value);
  try { localStorage.setItem('roamly-language', next); } catch { /* DOM still reflects the preference. */ }
  document.documentElement.lang = languageLocales[next];
  window.dispatchEvent(new Event(changed));
}

export function setBrowserTheme(dark: boolean) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#14201b' : '#fffdfa');
  try { localStorage.setItem('roamly-theme', dark ? 'dark' : 'light'); } catch { /* Theme still works. */ }
  window.dispatchEvent(new Event(changed));
}
