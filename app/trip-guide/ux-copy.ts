import type { Language } from '../i18n';

export const uxCopy = {
  pt: { searchMode: 'Onde buscar', saved: 'No roteiro', google: 'Google Maps', noMatches: 'Nenhum local corresponde à busca', clearHint: 'Limpe a busca ou altere os filtros.', retry: 'Tentar novamente', invalid: 'Alguns dados antigos de locais eram inválidos e foram recuperados com segurança. Revise os locais antes de compartilhar.' },
  es: { searchMode: 'Dónde buscar', saved: 'Itinerario', google: 'Google Maps', noMatches: 'Ningún lugar coincide con la búsqueda', clearHint: 'Borra la búsqueda o cambia los filtros.', retry: 'Reintentar', invalid: 'Se recuperaron de forma segura algunos datos antiguos no válidos. Revisa los lugares antes de compartir.' },
  en: { searchMode: 'Search in', saved: 'Itinerary', google: 'Google Maps', noMatches: 'No places match your search', clearHint: 'Clear the search or change the filters.', retry: 'Try again', invalid: 'Some invalid old place data was safely recovered. Review the places before sharing.' },
};

export function deletionDescription(language: Language, cloud: boolean, map: boolean) {
  if (!cloud) return language === 'es' ? 'Se eliminará de este dispositivo. Puedes añadirlo de nuevo más tarde.' : language === 'en' ? 'It will be removed from this device. You can add it again later.' : 'Será removido deste aparelho. Você pode adicioná-lo novamente depois.';
  const scope = language === 'es' ? 'Se eliminará de tu cuenta y tus dispositivos en la próxima sincronización.' : language === 'en' ? 'It will be removed from your account and devices on the next sync.' : 'Será removido da sua conta e dos seus aparelhos na próxima sincronização.';
  if (!map) return scope;
  return scope + (language === 'es' ? ' Los enlaces de invitación también se revocarán. Las copias ya guardadas por invitados no se eliminarán.' : language === 'en' ? ' Invitation links will also be revoked. Copies already saved by invitees will not be deleted.' : ' Os links de convite também serão revogados. Cópias já salvas pelos convidados não serão apagadas.');
}
