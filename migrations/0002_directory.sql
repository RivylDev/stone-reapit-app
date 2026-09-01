-- Office and agent directory pages.
--
-- The `offices` and `agents` tables already existed, but were filled from the
-- *listing* payload, which names an office and nothing else. A probe of the
-- Agentbox `/offices` and `/staff` endpoints (scripts/probe-directory.ts) found
-- both return a great deal more, so these columns are the fields that probe
-- confirmed exist — not a guess at what the API might hold.
--
-- What is deliberately NOT here:
--
--   dateOfBirth, homeAddress    `/staff/{id}` returns both. They are employee
--                               personal data with no place on a public site,
--                               so they are dropped at the mapping boundary and
--                               have no column to land in.
--   licenceNumber, startDate    Returned, but employment records rather than
--                               anything a property site needs.
--   photo                       No such field exists on `/staff` or
--                               `/staff/{id}`. Headshots are not available from
--                               this API at all, so `photo_url` stays null.
--
-- Publishability is deliberately not a column. `role`, `status` and
-- `web_display` are stored raw and the rule that reads them lives in
-- src/lib/queries/directory.ts, so changing who appears is a code change rather
-- than a re-sync of 837 records.

-- ------------------------------------------------------------------ offices --

-- Every identifier stays TEXT (hard rule 1). Office IDs are short numeric
-- strings in the sandbox and an INTEGER column would strip a leading zero.
ALTER TABLE offices ADD COLUMN slug           TEXT;
ALTER TABLE offices ADD COLUMN street_address TEXT;
ALTER TABLE offices ADD COLUMN country        TEXT;
ALTER TABLE offices ADD COLUMN website        TEXT;
ALTER TABLE offices ADD COLUMN latitude       REAL;
ALTER TABLE offices ADD COLUMN longitude      REAL;
ALTER TABLE offices ADD COLUMN status         TEXT;

-- Not UNIQUE: a partial unique index cannot be added by ALTER, and the slug is
-- null on every row until the first directory sync. Uniqueness is guaranteed at
-- generation instead — the office ID is appended to the name.
CREATE INDEX IF NOT EXISTS idx_offices_slug   ON offices (slug);
CREATE INDEX IF NOT EXISTS idx_offices_status ON offices (status);

-- ------------------------------------------------------------------- agents --

ALTER TABLE agents ADD COLUMN slug             TEXT;
ALTER TABLE agents ADD COLUMN job_title        TEXT;
-- The CRM role: Admin, Sales Representative, Principal, Property Management.
-- 98 of 108 sandbox staff are Admin, most of them test accounts, so this is the
-- main thing standing between the directory and a page full of them.
ALTER TABLE agents ADD COLUMN role             TEXT;
ALTER TABLE agents ADD COLUMN status           TEXT;
-- The biography. Empty on every sandbox record, but the field is real.
ALTER TABLE agents ADD COLUMN profile          TEXT;
-- JSON arrays, matching how `features` and `floorplans` are stored on listings.
ALTER TABLE agents ADD COLUMN specialist_areas TEXT NOT NULL DEFAULT '[]';
-- Agentbox's own publication flags, e.g. [{"name":"Our Staff"}]. An explicit
-- instruction from the CRM about where a person may appear on a website.
ALTER TABLE agents ADD COLUMN web_display      TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_agents_slug   ON agents (slug);
CREATE INDEX IF NOT EXISTS idx_agents_role   ON agents (role);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents (status);
