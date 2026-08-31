import { env } from 'cloudflare:workers';
import { createUserItinerariesTable } from '@/db/schema';

type RoamlyEnv = { DB?: D1Database };

export function database() {
  const db = (env as unknown as RoamlyEnv).DB;
  if (!db) throw new Error('Banco de dados do Roamly não configurado');
  return db;
}

export async function ensureDatabase(db: D1Database) {
  await db.prepare(createUserItinerariesTable).run();
}
