export const createUserItinerariesTable = `
  CREATE TABLE IF NOT EXISTS user_itineraries (
    user_id TEXT PRIMARY KEY NOT NULL,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
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
