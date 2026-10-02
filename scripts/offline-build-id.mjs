import { createHash } from 'node:crypto';

export function offlineBuildId(assets, serverShell, workerTemplate) {
  const hash = createHash('sha256');
  // Worker-only changes must never install into (or delete) the active cache.
  hash.update(workerTemplate).update(serverShell);
  for (const [name, contents] of assets) hash.update(name).update(contents);
  return hash.digest('hex').slice(0, 20);
}
