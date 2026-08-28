/**
 * Loads listings from a ListingSource into D1.
 *
 * Every write is an upsert keyed on the natural identifier, so running this
 * twice is a no-op. That is the point: the source feed contains genuine
 * duplicate IDs, and a re-run must not double anything up.
 *
 *   node --experimental-strip-types scripts/seed-d1.ts [--remote]
 *
 * Nothing here imports a concrete source. It asks the ingestion factory for a
 * `ListingSource` and works against the interface.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createListingSource } from '../src/lib/ingestion/index.ts';
import { loadSeedOffices, loadSeedAgents } from '../src/lib/ingestion/seed-data.ts';
import type { Listing } from '../src/lib/types/listing.ts';

const DATABASE = 'stone-listings';
const REMOTE = process.argv.includes('--remote');
/** Statements per file. Keeps any single wrangler invocation a sane size. */
const CHUNK = 400;

// ------------------------------------------------------------------- helpers --

function lit(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function row(values: unknown[]): string {
  return `(${values.map(lit).join(', ')})`;
}

/** `col=excluded.col` for every column except the conflict key(s). */
function updateClause(columns: string[], keys: string[]): string {
  return columns
    .filter((c) => !keys.includes(c))
    .map((c) => `${c}=excluded.${c}`)
    .join(', ');
}

function execute(statements: string[], label: string): void {
  if (statements.length === 0) return;

  const dir = mkdtempSync(join(tmpdir(), 'seed-d1-'));
  try {
    for (let i = 0; i < statements.length; i += CHUNK) {
      const slice = statements.slice(i, i + CHUNK);
      const file = join(dir, `${label}-${i}.sql`);
      writeFileSync(file, `${slice.join('\n')}\n`);

      const args = ['wrangler', 'd1', 'execute', DATABASE, '--file', file, '--yes'];
      args.push(REMOTE ? '--remote' : '--local');

      execFileSync('npx', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, CI: 'true' },
      });
    }
    console.log(`  ${label}: ${statements.length} statement(s)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------- main --

const startedAt = new Date().toISOString();
const source = createListingSource();

// Drain the source through the interface, exactly as a real sync would.
const feed: Listing[] = [];
let cursor: string | undefined;
do {
  const page = await source.fetchAll(cursor);
  feed.push(...page.listings);
  cursor = page.nextCursor;
} while (cursor !== undefined);

console.log(`Source returned ${feed.length} record(s).`);

/*
 * Collapse duplicate IDs, newest wins.
 *
 * Sorting by modifiedAt ascending and letting a Map overwrite means the most
 * recently modified record survives — the same rule MockSource.fetchOne
 * applies. Doing this in JS rather than leaning on ON CONFLICT also avoids
 * SQLite's refusal to let one statement touch the same row twice.
 */
const ordered = [...feed].sort((a, b) => Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt));
const byId = new Map<string, Listing>();
for (const listing of ordered) byId.set(listing.listingId, listing);
const listings = [...byId.values()];

const collapsed = feed.length - listings.length;
console.log(`${listings.length} distinct listing(s) after collapsing ${collapsed} duplicate ID(s).`);

const LISTING_COLUMNS = [
  'listing_id', 'unique_id', 'slug', 'status', 'property_type', 'category',
  'unit_number', 'street_number', 'street', 'suburb', 'state', 'postcode',
  'display_address', 'latitude', 'longitude', 'price_value', 'price_display',
  'price_searchable', 'bedrooms', 'bathrooms', 'carspaces', 'land_size',
  'land_size_unit', 'headline', 'description', 'features', 'floorplans',
  'video_url', 'office_id', 'listed_at', 'sold_at', 'modified_at',
  'raw_payload', 'last_seen_at', 'deleted_at',
];

const listingStatements = listings.map((l) => {
  const values = [
    l.listingId, l.uniqueId, l.slug, l.status, l.propertyType, l.category,
    l.unitNumber, l.streetNumber, l.street, l.suburb, l.state, l.postcode,
    l.displayAddress, l.latitude, l.longitude, l.priceValue, l.priceDisplay,
    l.priceSearchable, l.bedrooms, l.bathrooms, l.carspaces, l.landSize,
    l.landSizeUnit, l.headline, l.description,
    JSON.stringify(l.features), JSON.stringify(l.floorplans),
    l.videoUrl, l.officeId, l.listedAt, l.soldAt, l.modifiedAt,
    // The untouched source object, so a field needed later is re-normalised
    // from local data rather than re-fetched.
    JSON.stringify(l),
    startedAt,
    // Present in the feed means present. `deleted_at` is only ever set by a
    // sweep for records that stopped appearing, which keeps "absent" and
    // "withdrawn" (a status) distinguishable.
    null,
  ];
  return `INSERT INTO listings (${LISTING_COLUMNS.join(', ')}) VALUES ${row(values)} `
    + `ON CONFLICT(listing_id) DO UPDATE SET ${updateClause(LISTING_COLUMNS, ['listing_id'])};`;
});

/*
 * Child rows are replaced, not merged. If a listing loses an image the old row
 * would otherwise linger and the counts would drift on re-run. This is a delete
 * of child rows only — `listings` itself is never deleted from.
 */
const ids = listings.map((l) => lit(l.listingId));
const clearChildren: string[] = [];
for (let i = 0; i < ids.length; i += 200) {
  const slice = ids.slice(i, i + 200).join(', ');
  clearChildren.push(`DELETE FROM listing_images WHERE listing_id IN (${slice});`);
  clearChildren.push(`DELETE FROM listing_agents WHERE listing_id IN (${slice});`);
}

const imageStatements: string[] = [];
const agentLinkStatements: string[] = [];
for (const l of listings) {
  for (const image of l.images) {
    imageStatements.push(
      'INSERT INTO listing_images (listing_id, position, url, caption) VALUES '
      + `${row([l.listingId, image.order, image.url, image.caption])} `
      + 'ON CONFLICT(listing_id, position) DO UPDATE SET url=excluded.url, caption=excluded.caption;',
    );
  }
  l.agentIds.forEach((agentId, position) => {
    agentLinkStatements.push(
      'INSERT INTO listing_agents (listing_id, agent_id, position) VALUES '
      + `${row([l.listingId, agentId, position])} `
      + 'ON CONFLICT(listing_id, agent_id) DO UPDATE SET position=excluded.position;',
    );
  });
}

const OFFICE_COLUMNS = ['office_id', 'name', 'suburb', 'state', 'postcode', 'phone', 'email', 'raw_payload', 'last_seen_at'];
const officeStatements = loadSeedOffices().map((o) =>
  `INSERT INTO offices (${OFFICE_COLUMNS.join(', ')}) VALUES `
  + `${row([o.officeId, o.name, o.suburb, o.state, o.postcode, o.phone, o.email, JSON.stringify(o), startedAt])} `
  + `ON CONFLICT(office_id) DO UPDATE SET ${updateClause(OFFICE_COLUMNS, ['office_id'])};`);

const AGENT_COLUMNS = ['agent_id', 'first_name', 'last_name', 'full_name', 'office_id', 'phone', 'email', 'photo_url', 'raw_payload', 'last_seen_at'];
const agentStatements = loadSeedAgents().map((a) =>
  `INSERT INTO agents (${AGENT_COLUMNS.join(', ')}) VALUES `
  + `${row([a.agentId, a.firstName, a.lastName, a.fullName, a.officeId, a.phone, a.email, a.photoUrl, JSON.stringify(a), startedAt])} `
  + `ON CONFLICT(agent_id) DO UPDATE SET ${updateClause(AGENT_COLUMNS, ['agent_id'])};`);

console.log(`Writing to ${REMOTE ? 'remote' : 'local'} D1...`);
execute(officeStatements, 'offices');
execute(agentStatements, 'agents');
execute(listingStatements, 'listings');
execute(clearChildren, 'clear-children');
execute(imageStatements, 'listing_images');
execute(agentLinkStatements, 'listing_agents');

/*
 * sync_runs is an append-only audit log, so it is the one table that grows on
 * every run. That is deliberate — the idempotency check covers the data tables.
 */
const runId = `seed-${startedAt}`;
execute([
  'INSERT INTO sync_runs (run_id, source, started_at, finished_at, status, records_seen, records_upserted) VALUES '
  + `${row([runId, 'MockSource', startedAt, new Date().toISOString(), 'success', feed.length, listings.length])} `
  + 'ON CONFLICT(run_id) DO NOTHING;',
], 'sync_runs');

console.log('\nDone.');
