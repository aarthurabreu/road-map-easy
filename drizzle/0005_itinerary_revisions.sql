ALTER TABLE user_itineraries ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_itineraries ADD COLUMN write_id TEXT NOT NULL DEFAULT '';

CREATE TABLE itinerary_mutations (
  user_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, generation, mutation_id)
);
