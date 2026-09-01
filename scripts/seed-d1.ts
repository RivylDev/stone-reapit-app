/**
 * Loads listings from a ListingSource into D1.
 *
 * Every write is an upsert keyed on the natural identifier, so running this
 * twice is a no-op. That is the point: the source feed contains genuine
 * duplicate IDs, and a re-run must not double anything up.
 *
 *   node --experimental-strip-types scripts/seed-d1.ts [--remote]
 *   node --experimental-strip-types scripts/seed-d1.ts --agentbox
 *   node --experimental-strip-types scripts/seed-d1.ts --agentbox --allow-production
 *
 * Without `--agentbox` the source is the local fixture set, which is what makes
 * the command safe to run on any machine with no credentials in reach. With it,
 * the same run drains the live Agentbox feed instead — credentials from the
 * environment or `.dev.vars`, sandbox unless production is asked for by name.
 *
 * Nothing here imports a concrete source. It asks the ingestion factory for a
 * `ListingSource` and works against the interface.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createListingSource } from '../src/lib/ingestion/index.ts';
import { hasReferenceData, hasDirectory } from '../src/lib/ingestion/source.ts';
import { requireAgentboxCredentials, describeInstance } from './agentbox-credentials.ts';
import { loadSeedOffices, loadSeedAgents } from '../src/lib/ingestion/seed-data.ts';
import { isPublishableStaff } from '../src/lib/directory-policy.ts';
import type { Listing } from '../src/lib/types/listing.ts';

const DATABASE = 'stone-listings';

/*
 * Wrangler's JS entry point, run under this same Node binary.
 *
 * Not `npx`: on Windows that resolves to `npx.cmd`, and since Node 22 a `.cmd`
 * cannot be spawned without `shell: true` — which would then re-split any temp
 * path containing a space. Naming the script directly sidesteps both, and skips
 * npx's resolution step on every chunk as well.
 */
const WRANGLER_BIN = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
);
const REMOTE = process.argv.includes('--remote');
/**
 * Opt in to the live feed. Off by default: the factory's contract is that
 * Agentbox is a deliberate act with credentials in hand, and a seed run that
 * silently changed source the moment a `.dev.vars` appeared would break it.
 */
const AGENTBOX = process.argv.includes('--agentbox');
/**
 * Skip the per-listing detail fetch. Much faster, but the detail endpoint is
 * the only place `images` and a numeric price exist, so the result is a site
 * with no photos and no working price filter. For structural checks only.
 */
const NO_HYDRATE = process.argv.includes('--no-hydrate');
/** Stop after N listings. For a quick look without draining the instance. */
const LIMIT = readIntArg('--limit');

function readIntArg(flag: string): number | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;

  const value = Number.parseInt(process.argv[index + 1] ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}
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

      const args = [WRANGLER_BIN, 'd1', 'execute', DATABASE, '--file', file, '--yes'];
      args.push(REMOTE ? '--remote' : '--local');

      try {
        execFileSync(process.execPath, args, {
          stdio: ['ignore', 'ignore', 'pipe'],
          env: { ...process.env, CI: 'true' },
        });
      } catch (error) {
        // wrangler's diagnostics arrive on stderr as a Buffer. Without this the
        // failure surfaces as a wall of byte values and the SQL is unreadable.
        const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
        throw new Error(`wrangler failed on ${label} (${file}):\n${stderr.trim()}`);
      }
    }
    console.log(`  ${label}: ${statements.length} statement(s)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------- main --

const startedAt = new Date().toISOString();

/*
 * The source is named as well as built, because `sync_runs` records which feed
 * a row came from. A run labelled `MockSource` when it drained Agentbox makes
 * the audit log actively misleading.
 */
const credentials = AGENTBOX ? requireAgentboxCredentials() : null;
const sourceName = credentials ? `AgentboxSource (${describeInstance(credentials)})` : 'MockSource';

if (credentials) {
  console.log(`Source: Agentbox — ${describeInstance(credentials)}`);
  if (!credentials.sandbox) console.log('Reading LIVE data. This was asked for explicitly.');
} else {
  console.log('Source: local fixtures. Pass --agentbox to drain the live feed instead.');
}

const source = createListingSource(
  credentials
    ? {
        agentbox: {
          enabled: true,
          clientId: credentials.clientId,
          apiKey: credentials.apiKey,
          allowProduction: credentials.allowProduction,
          hydrate: !NO_HYDRATE,
          onProgress: (doneCount, total) => {
            process.stdout.write(`\r  hydrating ${doneCount}/${total}…   `);
          },
        },
      }
    : {},
);

if (AGENTBOX && NO_HYDRATE) {
  console.log('Skipping detail fetches: no images and no numeric prices.');
}
if (LIMIT !== null) console.log(`Stopping after ${LIMIT} listing(s).`);

// Drain the source through the interface, exactly as a real sync would.
const feed: Listing[] = [];
let cursor: string | undefined;
do {
  const page = await source.fetchAll(cursor);
  feed.push(...page.listings);
  cursor = page.nextCursor;
} while (cursor !== undefined && (LIMIT === null || feed.length < LIMIT));

if (LIMIT !== null && feed.length > LIMIT) feed.length = LIMIT;

// The progress line is rewritten in place; this ends it.
if (AGENTBOX && !NO_HYDRATE) process.stdout.write('\n');

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

/*
 * Reference data comes from the source when the source has it.
 *
 * Agentbox embeds the full staff record in every listing, so draining the feed
 * has already produced the agent and office directories. Falling back to the
 * fixture files here would leave every real listing joined to an agent row that
 * does not exist, and the cards would render "Stone" with no phone number.
 */
/**
 * Combines two directory lists, letting the second win on a shared ID.
 *
 * Keeps anyone present only in the first list — a staff member who fronts a
 * listing but is missing from `/staff` still needs a row, or the property page
 * joins to nothing.
 */
function mergeById<T>(base: T[], preferred: T[], id: (item: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const item of base) merged.set(id(item), item);
  for (const item of preferred) merged.set(id(item), item);
  return [...merged.values()];
}

/*
 * Three places the directory can come from, in descending order of quality.
 *
 * 1. The dedicated `/offices` and `/staff` endpoints, when the source can reach
 *    them. This is the only one that yields an office's address, phone and
 *    coordinates, or a staff member's role and biography — and the only one
 *    that finds the staff who front no listing (108 against the feed's 59).
 * 2. What fell out of the listing feed. Free, but an office name and nothing
 *    else, and only the staff attached to a listing.
 * 3. The fixture files, for a source that carries no reference data at all.
 */
let offices = hasReferenceData(source) ? source.collectedOffices() : loadSeedOffices();
let agents = hasReferenceData(source) ? source.collectedAgents() : loadSeedAgents();

if (hasDirectory(source)) {
  console.log('Fetching the office and staff directory...');
  try {
    const [fetchedOffices, fetchedStaff] = await Promise.all([
      source.fetchOffices(),
      source.fetchStaff(),
    ]);

    /*
     * Merged, not replaced. The directory endpoints are richer but a staff
     * member could in principle front a listing without appearing on `/staff`;
     * dropping them would break the join the property page depends on. The
     * fetched record wins on conflict, since it carries strictly more.
     */
    offices = mergeById(offices, fetchedOffices, (o) => o.officeId);
    agents = mergeById(agents, fetchedStaff, (a) => a.agentId);
  } catch (error) {
    // A failed directory fetch must not cost the listing sync. The collected
    // reference data is thinner but keeps every property page joined up.
    console.warn(
      `Directory fetch failed, falling back to what the listing feed carried: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const publishableAgents = agents.filter((a) => isPublishableStaff(a)).length;
console.log(
  `${offices.length} office(s), ${agents.length} agent(s) from the source `
  + `(${publishableAgents} publishable on the directory).`,
);

const OFFICE_COLUMNS = [
  'office_id', 'name', 'slug', 'street_address', 'suburb', 'state', 'postcode',
  'country', 'phone', 'email', 'website', 'latitude', 'longitude', 'status',
  'raw_payload', 'last_seen_at',
];
const officeStatements = offices.map((o) =>
  `INSERT INTO offices (${OFFICE_COLUMNS.join(', ')}) VALUES `
  + `${row([
    o.officeId, o.name, o.slug, o.streetAddress, o.suburb, o.state, o.postcode,
    o.country, o.phone, o.email, o.website, o.latitude, o.longitude, o.status,
    JSON.stringify(o), startedAt,
  ])} `
  + `ON CONFLICT(office_id) DO UPDATE SET ${updateClause(OFFICE_COLUMNS, ['office_id'])};`);

const AGENT_COLUMNS = [
  'agent_id', 'slug', 'first_name', 'last_name', 'full_name', 'office_id',
  'phone', 'email', 'photo_url', 'job_title', 'role', 'status', 'profile',
  'specialist_areas', 'web_display', 'raw_payload', 'last_seen_at',
];
const agentStatements = agents.map((a) =>
  `INSERT INTO agents (${AGENT_COLUMNS.join(', ')}) VALUES `
  + `${row([
    a.agentId, a.slug, a.firstName, a.lastName, a.fullName, a.officeId,
    a.phone, a.email, a.photoUrl, a.jobTitle, a.role, a.status, a.profile,
    JSON.stringify(a.specialistAreas), JSON.stringify(a.webDisplay),
    JSON.stringify(a), startedAt,
  ])} `
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
  + `${row([runId, sourceName, startedAt, new Date().toISOString(), 'success', feed.length, listings.length])} `
  + 'ON CONFLICT(run_id) DO NOTHING;',
], 'sync_runs');

console.log('\nDone.');
