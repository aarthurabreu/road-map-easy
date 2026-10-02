import { languageLocales, type Language } from '../i18n';
import type { GoogleIdentityApi } from './types';

let mapsPending: Promise<void> | null = null;
export function loadGoogleMaps(apiKey: string, language: Language) {
  const runtimeWindow = window as Window & { google?: typeof google; __roamlyGoogleMapsReady?: () => void };
  if (runtimeWindow.google?.maps?.Map) return Promise.resolve();
  if (mapsPending) return mapsPending;
  mapsPending = new Promise<void>((resolve, reject) => {
    // A failed script from a previous attempt must not trap every future retry.
    document.querySelector('script[data-roamly-google-maps]')?.remove();
    const script = document.createElement('script');
    script.dataset.roamlyGoogleMaps = 'true';
    script.async = true;
    const finish = (error?: Error) => {
      window.clearTimeout(timeout); script.onerror = null;
      delete runtimeWindow.__roamlyGoogleMapsReady;
      if (error) { script.remove(); reject(error); } else resolve();
    };
    const timeout = window.setTimeout(() => finish(new Error('O Google Maps demorou demais para responder.')), 15_000);
    runtimeWindow.__roamlyGoogleMapsReady = () => finish(runtimeWindow.google?.maps?.Map ? undefined : new Error('Google Maps indisponível'));
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&language=${encodeURIComponent(languageLocales[language])}&region=BR&libraries=places,marker&callback=__roamlyGoogleMapsReady`;
    script.onerror = () => finish(new Error('Falha ao carregar o Google Maps. Confira a chave e as APIs habilitadas.'));
    document.head.appendChild(script);
  }).finally(() => { mapsPending = null; });
  return mapsPending;
}

let identityPending: Promise<GoogleIdentityApi> | null = null;
export function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  const current = (window as unknown as { google?: { accounts?: { id?: GoogleIdentityApi } } }).google?.accounts?.id;
  if (current) return Promise.resolve(current);
  if (identityPending) return identityPending;
  identityPending = new Promise<GoogleIdentityApi>((resolve, reject) => {
    document.querySelector('script[data-roamly-google-identity]')?.remove();
    const script = document.createElement('script');
    const finish = (error?: Error) => {
      window.clearTimeout(timeout); script.onload = null; script.onerror = null;
      const identity = (window as unknown as { google?: { accounts?: { id?: GoogleIdentityApi } } }).google?.accounts?.id;
      if (!error && identity) resolve(identity);
      else { script.remove(); reject(error ?? new Error('Google Identity indisponível')); }
    };
    const timeout = window.setTimeout(() => finish(new Error('Google Identity demorou demais para responder')), 15_000);
    script.onload = () => finish();
    script.onerror = () => finish(new Error('Falha ao carregar Google Identity'));
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true;
    script.dataset.roamlyGoogleIdentity = 'true';
    document.head.appendChild(script);
  }).finally(() => { identityPending = null; });
  return identityPending;
}
