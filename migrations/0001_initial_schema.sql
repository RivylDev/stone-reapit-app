-- Initial schema for the listing feed.
--
-- Every identifier is TEXT. Listing IDs are mostly 7 digits but some are 6, and
-- the second identifier appears in 100P###### and IRE####### forms. An INTEGER
-- column would corrupt all of those silently.
--
-- Deletes are soft. `last_seen_at` records the last sync that observed the
-- record; `deleted_at` records a deliberate removal. The source feed does not
-- reliably signal removal, so "absent from the feed" and "withdrawn by the
-- vendor" must stay distinguishable.
--
-- `raw_payload` holds the untouched source object on every row, so a field that
-- turns out to be needed later is re-normalised from local data rather than
-- re-fetched.

-- ------------------------------------------------------------------ offices --

CREATE TABLE IF NOT EXISTS offices (
  office_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  suburb        TEXT,
  state         TEXT,
  postcode      TEXT,
  phone         TEXT,
  email         TEXT,
  raw_payload   TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  deleted_at    TEXT
);

-- ------------------------------------------------------------------- agents --

CREATE TABLE IF NOT EXISTS agents (
  agent_id      TEXT PRIMARY KEY,
  first_name    TEXT,
  last_name     TEXT,
  full_name     TEXT,
  office_id     TEXT,
  phone         TEXT,
  email         TEXT,
  photo_url     TEXT,
  raw_payload   TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_agents_office ON agents (office_id);

-- ----------------------------------------------------------------- listings --

CREATE TABLE IF NOT EXISTS listings (
  listing_id        TEXT PRIMARY KEY,
  unique_id         TEXT,
  slug              TEXT NOT NULL,
  status            TEXT NOT NULL,
  property_type     TEXT NOT NULL,
  category          TEXT NOT NULL,
  unit_number       TEXT,
  street_number     TEXT,
  street            TEXT,
  suburb            TEXT NOT NULL,
  state             TEXT NOT NULL,
  postcode          TEXT,
  display_address   TEXT NOT NULL,
  latitude          REAL,
  longitude         REAL,
  -- Price is three columns on purpose. price_value filters, price_display
  -- renders, price_searchable handles vendors who hide the price. Do not
  -- collapse them.
  price_value       INTEGER,
  price_display     TEXT NOT NULL,
  price_searchable  INTEGER NOT NULL DEFAULT 1,
  bedrooms          INTEGER,
  bathrooms         INTEGER,
  carspaces         INTEGER,
  land_size         REAL,
  land_size_unit    TEXT,
  headline          TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  -- JSON arrays. Images and agents are also relational (see below); these
  -- columns keep the source ordering intact for re-normalisation.
  features          TEXT NOT NULL DEFAULT '[]',
  floorplans        TEXT NOT NULL DEFAULT '[]',
  video_url         TEXT,
  office_id         TEXT,
  listed_at         TEXT,
  sold_at           TEXT,
  modified_at       TEXT NOT NULL,
  raw_payload       TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  deleted_at        TEXT
);

-- Facet indexes: status, suburb, price, bedrooms, office.
CREATE INDEX IF NOT EXISTS idx_listings_status    ON listings (status);
CREATE INDEX IF NOT EXISTS idx_listings_suburb    ON listings (suburb);
CREATE INDEX IF NOT EXISTS idx_listings_price     ON listings (price_value);
CREATE INDEX IF NOT EXISTS idx_listings_bedrooms  ON listings (bedrooms);
CREATE INDEX IF NOT EXISTS idx_listings_office    ON listings (office_id);

-- Also filtered on by search(), so they earn an index too.
CREATE INDEX IF NOT EXISTS idx_listings_state         ON listings (state);
CREATE INDEX IF NOT EXISTS idx_listings_property_type ON listings (property_type);

-- Every query excludes soft-deleted rows, so lead with deleted_at.
CREATE INDEX IF NOT EXISTS idx_listings_live ON listings (deleted_at, status, suburb);

CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_slug ON listings (slug);

-- ----------------------------------------------------------- listing_images --

-- `position` rather than `order`, which is a reserved word. The composite
-- primary key is what makes image upserts idempotent.
CREATE TABLE IF NOT EXISTS listing_images (
  listing_id  TEXT NOT NULL,
  position    INTEGER NOT NULL,
  url         TEXT NOT NULL,
  caption     TEXT,
  PRIMARY KEY (listing_id, position)
);

CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON listing_images (listing_id);

-- ----------------------------------------------------------- listing_agents --

CREATE TABLE IF NOT EXISTS listing_agents (
  listing_id  TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (listing_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_agents_agent ON listing_agents (agent_id);

-- --------------------------------------------------------------- sync_runs --

CREATE TABLE IF NOT EXISTS sync_runs (
  run_id            TEXT PRIMARY KEY,
  source            TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  status            TEXT NOT NULL,
  records_seen      INTEGER NOT NULL DEFAULT 0,
  records_upserted  INTEGER NOT NULL DEFAULT 0,
  error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs (started_at);
