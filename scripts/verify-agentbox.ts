/**
 * Proves the local database holds real Agentbox data, by re-fetching it.
 *
 * Takes a random sample of listings out of D1, asks the API for those same
 * IDs, and compares field by field. A row that was fabricated, or seeded from
 * the fixtures, cannot survive this: the API would 404 the ID, or return
 * something that does not match.
 *
 *   npm run agentbox:verify
 *   npm run agentbox:verify -- --sample 25
 *
 * Read-only on both sides, and it reads the D1 file directly, so it works with
 * the dev server running. Exits non-zero if anything fails to match, so it
 * doubles as a drift check after a schema or mapping change.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { AgentboxClient } from '../src/lib/ingestion/agentbox-client.ts';
import { mapListing } from '../src/lib/ingestion/agentbox-mapping.ts';
import { requireAgentboxCredentials, describeInstance } from './agentbox-credentials.ts';
import type { Listing } from '../src/lib/types/listing.ts';

/*
 * The local D1 file is read directly, read-only, rather than through
 * `wrangler d1 execute`.
 *
 * Miniflare holds a write lock on it whenever a dev server is up, and going
 * through the CLI then fails with SQLITE_BUSY — which would mean stopping the
 * app to check the app's data. A read-only handle takes no lock and is
 * unaffected.
 */
function openLocalD1(): DatabaseSync {
  const dir = fileURLToPath(
    new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url),
  );

  let files: string[];
  try {
    // The database file is named by a hash of the binding; `metadata.sqlite` is
    // miniflare's own bookkeeping and is not it.
    files = readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  } catch {
    console.error(`No local D1 state at ${dir}\nRun \`npm run db:migrate\` first.`);
    process.exit(1);
  }

  if (files.length !== 1) {
    console.error(`Expected exactly one D1 database file in ${dir}, found ${files.length}.`);
    process.exit(1);
  }

  return new DatabaseSync(join(dir, files[0]), { readOnly: true });
}

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;

  const value = Number.parseInt(process.argv[index + 1] ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const SAMPLE = arg('sample', 12);

const credentials = requireAgentboxCredentials();
const client = new AgentboxClient({
  credentials: { clientId: credentials.clientId, apiKey: credentials.apiKey },
  allowProduction: credentials.allowProduction,
});

console.log(`Instance: ${describeInstance(credentials)}`);
console.log(`Sampling ${SAMPLE} listing(s) at random from local D1.\n`);

interface Row {
  listing_id: string;
  display_address: string;
  suburb: string;
  price_display: string;
  bedrooms: number | null;
  bathrooms: number | null;
  carspaces: number | null;
  modified_at: string;
  photos: number;
}

const db = openLocalD1();

const rows = db.prepare(
  'SELECT l.listing_id, l.display_address, l.suburb, l.price_display, l.bedrooms, '
  + 'l.bathrooms, l.carspaces, l.modified_at, '
  + '(SELECT COUNT(*) FROM listing_images i WHERE i.listing_id = l.listing_id) AS photos '
  + 'FROM listings l ORDER BY RANDOM() LIMIT ?',
).all(SAMPLE) as unknown as Row[];

if (rows.length === 0) {
  console.error('No listings in the local database. Seed it first.');
  process.exit(1);
}

let matched = 0;
const problems: string[] = [];

for (const row of rows) {
  const body = await client.get<Record<string, unknown>>(
    `/listings/${encodeURIComponent(row.listing_id)}`,
    { include: 'images,relatedStaffMembers,mainDescription' },
  );

  const raw = Array.isArray(body) ? body[0] : (body?.listing ?? body);

  if (raw === null || raw === undefined) {
    problems.push(`${row.listing_id}: the API returned nothing for this ID`);
    continue;
  }

  const live: Listing = mapListing(raw);

  const checks: [string, unknown, unknown][] = [
    ['address', row.display_address, live.displayAddress],
    ['suburb', row.suburb, live.suburb],
    ['price', row.price_display, live.priceDisplay],
    ['bedrooms', row.bedrooms, live.bedrooms],
    ['bathrooms', row.bathrooms, live.bathrooms],
    ['carspaces', row.carspaces, live.carspaces],
    ['photos', row.photos, live.images.length],
  ];

  const failed = checks.filter(([, stored, fresh]) => (stored ?? null) !== (fresh ?? null));

  if (failed.length === 0) {
    matched += 1;
    console.log(
      `  ok  ${row.listing_id.padEnd(10)} ${row.display_address.slice(0, 46).padEnd(46)} `
      + `${String(row.price_display).padEnd(14)} ${row.photos} photo(s)`,
    );
  } else {
    console.log(`  ✗   ${row.listing_id}`);
    for (const [field, stored, fresh] of failed) {
      console.log(`        ${field}: database ${JSON.stringify(stored)} vs API ${JSON.stringify(fresh)}`);
    }
    problems.push(`${row.listing_id}: ${failed.map(([f]) => f).join(', ')}`);
  }
}

console.log(`\n${matched}/${rows.length} listing(s) matched the live API exactly.`);

if (problems.length > 0) {
  console.error('\nMismatches:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log('Every sampled row came back identical from Agentbox.');
