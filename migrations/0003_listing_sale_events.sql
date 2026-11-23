-- Auction details, open homes and public documents.
--
-- Confirmed against the production Agentbox instance on 23 Nov 2026 (read-only
-- probe), not guessed from the reference:
--
--   method           "Auction", "Private Treaty", "Offers to Purchase" or "".
--   auctionDate      ISO 8601 with offset. Survives a switch away from auction,
--                    so it means nothing without `sale_method`.
--   inspectionDates  `/listings/{id}` with `include=inspectionDates` only:
--                    [{ id, startDate, endDate }].
--   documents        `/listings/{id}` with `include=documents` only. Every file
--                    on the listing comes back, including the agency agreement
--                    (`private: true`). The mapping keeps only documents that
--                    are web-display and not private; the rest never reach a
--                    column, or `raw_payload`, which the loaders fill from the
--                    mapped listing.
--
-- JSON arrays, like `features` and `floorplans`, because a page reads them
-- whole and nothing filters on their contents yet. If "open homes this
-- Saturday" becomes a search facet, inspections earn a child table.

ALTER TABLE listings ADD COLUMN sale_method   TEXT;
ALTER TABLE listings ADD COLUMN auction_at    TEXT;
ALTER TABLE listings ADD COLUMN auction_venue TEXT;
ALTER TABLE listings ADD COLUMN inspections   TEXT NOT NULL DEFAULT '[]';
ALTER TABLE listings ADD COLUMN documents     TEXT NOT NULL DEFAULT '[]';
