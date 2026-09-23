CREATE TABLE IF NOT EXISTS map_shares (
  share_id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL,
  owner_generation TEXT NOT NULL,
  map_name TEXT NOT NULL,
  invited_email TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_map_shares_owner_map_email
ON map_shares (owner_user_id, owner_generation, map_name, invited_email);
