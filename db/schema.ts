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
