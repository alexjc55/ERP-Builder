CREATE TABLE IF NOT EXISTS card_style_presets (
  id serial PRIMARY KEY,
  name text NOT NULL,
  appearance jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1
);
