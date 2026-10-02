import { accountFetch } from '../account-storage';
import { withoutDistance } from '../data-privacy';
import { dedupePlaces } from './place-model';
import type { Place } from './types';

export async function saveCloudState(owner: string, maps: string[], currentMap: string, places: Place[], baseRevision: number, mutationIds: string[]) {
  const response = await accountFetch(owner, '/api/sync', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maps, currentMap, places: dedupePlaces(places).map(withoutDistance), baseRevision, mutationIds }),
  });
  if (!response.ok && response.status !== 412) throw new Error('Não foi possível sincronizar seus roteiros');
  return response;
}
