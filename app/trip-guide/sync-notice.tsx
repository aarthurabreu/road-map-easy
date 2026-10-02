import type { Language } from '../i18n';
import { keyFor, type Itinerary, type SyncConflict } from '../itinerary-sync';
import type { SyncStatus } from './types';

const copy = {
  pt: { offline: 'Sem conexão. As alterações aguardam envio.', pending: 'Alterações aguardando sincronização.', error: 'Não foi possível sincronizar. Suas alterações continuam neste aparelho.', conflict: 'Este roteiro mudou em outro aparelho.', explain: 'Escolha qual versão manter para as informações em conflito. As demais alterações serão preservadas.', local: 'Neste aparelho', cloud: 'Na nuvem', keep: 'Manter minhas alterações', use: 'Usar versão da nuvem', retry: 'Tentar novamente', storage: 'Não foi possível guardar todas as alterações no aparelho. Mantenha o app aberto até sincronizar ou baixe uma cópia.', download: 'Baixar uma cópia', note: 'Nota', pin: 'Cor do pin', map: 'Mapa', place: 'Local', removed: 'Removido', empty: 'Sem informação', saved: 'Salvo' },
  es: { offline: 'Sin conexión. Los cambios esperan su envío.', pending: 'Cambios pendientes de sincronización.', error: 'No se pudo sincronizar. Tus cambios siguen en este dispositivo.', conflict: 'Este itinerario cambió en otro dispositivo.', explain: 'Elige qué versión conservar para la información en conflicto. Los demás cambios se conservarán.', local: 'En este dispositivo', cloud: 'En la nube', keep: 'Conservar mis cambios', use: 'Usar versión de la nube', retry: 'Reintentar', storage: 'No se pudieron guardar todos los cambios en el dispositivo. Mantén la app abierta hasta sincronizar o descarga una copia.', download: 'Descargar una copia', note: 'Nota', pin: 'Color del marcador', map: 'Mapa', place: 'Lugar', removed: 'Eliminado', empty: 'Sin información', saved: 'Guardado' },
  en: { offline: 'Offline. Changes are waiting to be sent.', pending: 'Changes waiting to sync.', error: 'Could not sync. Your changes remain on this device.', conflict: 'This itinerary changed on another device.', explain: 'Choose which version to keep for conflicting information. Other changes will be preserved.', local: 'On this device', cloud: 'In the cloud', keep: 'Keep my changes', use: 'Use cloud version', retry: 'Try again', storage: 'Not all changes could be stored on this device. Keep the app open until it syncs or download a copy.', download: 'Download a copy', note: 'Note', pin: 'Pin color', map: 'Map', place: 'Place', removed: 'Removed', empty: 'No information', saved: 'Saved' },
};
export function syncStatusLabel(status: SyncStatus, language: Language) {
  const c = copy[language];
  return status === 'offline' ? c.offline : status === 'pending' ? c.pending : status === 'conflict' ? c.conflict : null;
}
export function SyncNotice({ status, conflicts, data, storageIssue, language, retry, resolve, download, authenticated = true }: {
  status: SyncStatus; conflicts: SyncConflict[]; storageIssue: boolean; language: Language;
  data: Itinerary;
  authenticated?: boolean;
  retry: () => void; resolve: (choice: 'local' | 'cloud') => void; download: () => void;
}) {
  const c = copy[language];
  if (!storageIssue && !conflicts.length && !['offline', 'pending', 'error'].includes(status)) return null;
  const showValue = (value: unknown) => value === null ? c.removed : typeof value === 'string' ? value || c.empty : c.saved;
  const finalLocal = (item: SyncConflict) => {
    const operation = item.operation;
    const place = data.places.find((place) => keyFor(place) === operation.key);
    return operation.kind === 'field' ? place?.[operation.field!] ?? null
      : operation.kind === 'place' ? place ?? null : data.maps.includes(operation.map) ? [] : null;
  };
  const displayed = conflicts.filter((item, index) => conflicts.findIndex((other) => other.operation.kind === item.operation.kind && other.operation.map === item.operation.map && other.operation.key === item.operation.key && other.operation.field === item.operation.field) === index);
  return <section className={`sync-notice${conflicts.length ? ' has-conflicts' : ''}`} aria-label={conflicts.length ? c.conflict : c.pending}>
    {storageIssue && <p role="alert">{authenticated ? c.storage : language === 'es' ? 'No se pudieron guardar los cambios en este dispositivo. Mantén la app abierta y descarga una copia.' : language === 'en' ? 'Changes could not be saved on this device. Keep the app open and download a copy.' : 'Não foi possível salvar as alterações neste aparelho. Mantenha o app aberto e baixe uma cópia.'}</p>}
    {conflicts.length ? <>
      <strong>{c.conflict}</strong><p>{c.explain}</p>
      <div className="sync-conflicts">{displayed.map((item) => {
        const { operation, cloud } = item;
        return <article key={operation.id}>
        <strong>{operation.map} · {operation.place?.name ?? (operation.kind === 'map' ? c.map : c.place)} · {operation.field === 'note' ? c.note : operation.field === 'pinColor' ? c.pin : ''}</strong>
        <dl><div><dt>{c.local}</dt><dd>{showValue(finalLocal(item))}</dd></div><div><dt>{c.cloud}</dt><dd>{showValue(cloud)}</dd></div></dl>
      </article>; })}</div>
      <div className="sync-notice-actions"><button disabled={status === 'syncing'} onClick={() => resolve('local')}>{c.keep}</button><button disabled={status === 'syncing'} onClick={() => resolve('cloud')}>{c.use}</button></div>
    </> : authenticated && <><p role="status">{c[status === 'offline' ? 'offline' : status === 'error' ? 'error' : 'pending']}</p><button onClick={retry}>{c.retry}</button></>}
    {storageIssue && <button onClick={download}>{c.download}</button>}
  </section>;
}
