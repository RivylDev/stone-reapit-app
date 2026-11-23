-- Links, rental terms, projects, auction venue and confidential sale prices.
--
-- Confirmed against the production Agentbox instance on 23 Nov 2026 (read-only
-- probes), alongside 0003:
--
--   externalLinks            `/listings/{id}` with `include=externalLinks`.
--                            YouTube videos, virtual tours, and Diakrit's
--                            Furnish, Panorama and Styling renders.
--   availableDate, bond      On rentals.
--   project                  A reference object, { id, name, ... }, on listings
--                            that belong to a New Projects development.
--   auctionVenueDetails      { name, address, phone }.
--   soldPriceConfidential    True on 8 of 15 recent sales. The mapping keeps a
--                            dollar figure out of `price_display` when it is.
--
-- Also corrects 0002's note that headshots are not available: they are, on
-- `/staff/{id}` with `include=images`, and land in the existing
-- `agents.photo_url` column.

ALTER TABLE listings ADD COLUMN links                   TEXT NOT NULL DEFAULT '[]';
ALTER TABLE listings ADD COLUMN available_from          TEXT;
ALTER TABLE listings ADD COLUMN bond                    REAL;
ALTER TABLE listings ADD COLUMN project_id              TEXT;
ALTER TABLE listings ADD COLUMN project_name            TEXT;
ALTER TABLE listings ADD COLUMN auction_venue_details   TEXT;
ALTER TABLE listings ADD COLUMN sold_price_confidential INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_listings_project ON listings (project_id);
