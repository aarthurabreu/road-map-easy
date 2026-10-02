export const createUserItinerariesTable = `
  CREATE TABLE IF NOT EXISTS user_itineraries (
    user_id TEXT PRIMARY KEY NOT NULL,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    write_id TEXT NOT NULL DEFAULT ''
  )
`;

export const createUserAccountsTable = `
  CREATE TABLE IF NOT EXISTS user_accounts (
    user_id TEXT PRIMARY KEY NOT NULL,
    generation TEXT NOT NULL
  )
`;

export const createMapSharesTable = `
  CREATE TABLE IF NOT EXISTS map_shares (
    share_id TEXT PRIMARY KEY NOT NULL,
    owner_user_id TEXT NOT NULL,
    owner_generation TEXT NOT NULL,
    map_name TEXT NOT NULL,
    invited_email TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`;

export const createAuthSessionsTable = `
  CREATE TABLE IF NOT EXISTS auth_sessions (
    session_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    generation TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )
`;

export const createInviteEmailAttemptsTable = `
  CREATE TABLE IF NOT EXISTS invite_email_attempts (
    attempt_id TEXT PRIMARY KEY NOT NULL,
    owner_key TEXT NOT NULL,
    recipient_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`;

export const createItineraryMutationsTable = `
  CREATE TABLE itinerary_mutations (
    user_id TEXT NOT NULL,
    generation TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    PRIMARY KEY (user_id, generation, mutation_id)
  )
`;
